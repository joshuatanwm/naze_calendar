"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireOwner, requireContractAccess } from "@/lib/permissions";
import { syncMilestoneToGoogle, deleteMilestoneFromGoogle } from "@/lib/google-calendar";

import { STAGE_LABELS, STAGE_PERCENTAGES } from "./helpers";

const contractSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  totalAmount: z.coerce.number().positive(),
  stage1Amount: z.coerce.number().nonnegative(),
  status: z.enum(["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"]),
  startDate: z.coerce.date(),
  assignedUserIds: z.array(z.string()).default([]),
});

function calcMilestoneAmounts(total: number, stage1Amount: number) {
  const remainder = total - stage1Amount;
  return [
    stage1Amount,
    Math.round(remainder * 0.50 * 100) / 100,
    Math.round(remainder * 0.35 * 100) / 100,
    Math.round(remainder * 0.10 * 100) / 100,
    Math.round(remainder * 0.05 * 100) / 100,
  ];
}

function parseAssignedUserIds(formData: FormData): string[] {
  return formData.getAll("assignedUserIds").map((v) => String(v)).filter(Boolean);
}

function buildPayload(formData: FormData) {
  return {
    clientId: String(formData.get("clientId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    totalAmount: String(formData.get("totalAmount") ?? "0"),
    stage1Amount: String(formData.get("stage1Amount") ?? "0"),
    status: String(formData.get("status") ?? "DRAFT"),
    startDate: String(formData.get("startDate") ?? ""),
    assignedUserIds: parseAssignedUserIds(formData),
  };
}

export async function createContract(formData: FormData) {
  const user = await requireOwner();
  const data = contractSchema.parse(buildPayload(formData));

  const amounts = calcMilestoneAmounts(data.totalAmount, data.stage1Amount);

  const contract = await prisma.contract.create({
    data: {
      clientId: data.clientId,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      totalAmount: new Prisma.Decimal(data.totalAmount),
      status: data.status,
      startDate: data.startDate,
      createdById: user.id,
      payments: {
        create: STAGE_LABELS.map((label, idx) => ({
          stage: idx + 1,
          label,
          amount: new Prisma.Decimal(amounts[idx]),
        })),
      },
      assignments: {
        create: data.assignedUserIds.map((userId) => ({ userId })),
      },
    },
  });

  // Mark the client as CLOSED immediately since they now have a project
  await prisma.client.update({
    where: { id: data.clientId },
    data: { clientStatus: "CLOSED" },
  });

  revalidatePath("/contracts");
  revalidatePath("/clients");
  redirect(`/contracts/${contract.id}`);
}

export async function updateContract(id: string, formData: FormData) {
  await requireContractAccess(id);
  const data = contractSchema.parse(buildPayload(formData));

  const amounts = calcMilestoneAmounts(data.totalAmount, data.stage1Amount);

  // Preserve amounts for already-paid milestones — they are historical payment records
  const paidMilestones = await prisma.paymentMilestone.findMany({
    where: { contractId: id, status: "PAID" },
    select: { stage: true },
  });
  const paidStages = new Set(paidMilestones.map((m) => m.stage));

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id },
      data: {
        clientId: data.clientId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        totalAmount: new Prisma.Decimal(data.totalAmount),
        status: data.status,
        startDate: data.startDate,
      },
    });

    for (let idx = 0; idx < STAGE_LABELS.length; idx++) {
      const stage = idx + 1;
      await tx.paymentMilestone.upsert({
        where: { contractId_stage: { contractId: id, stage } },
        update: {
          label: STAGE_LABELS[idx],
          // Don't overwrite amounts that have already been paid
          ...(!paidStages.has(stage) && { amount: new Prisma.Decimal(amounts[idx]) }),
        },
        create: {
          contractId: id,
          stage,
          label: STAGE_LABELS[idx],
          amount: new Prisma.Decimal(amounts[idx]),
        },
      });
    }

    await tx.contractAssignment.deleteMany({ where: { contractId: id } });
    if (data.assignedUserIds.length > 0) {
      await tx.contractAssignment.createMany({
        data: data.assignedUserIds.map((userId) => ({ contractId: id, userId })),
      });
    }
  });

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);
  redirect(`/contracts/${id}`);
}

export async function deleteContract(id: string) {
  await requireOwner();
  await prisma.contract.delete({ where: { id } });
  revalidatePath("/contracts");
  redirect("/contracts");
}

const markPaidSchema = z.object({
  paid: z.enum(["true", "false"]),
});

export async function clearPaymentDue(milestoneId: string) {
  const { contractId: cid } = await prisma.paymentMilestone.findUniqueOrThrow({
    where: { id: milestoneId },
    select: { contractId: true },
  });
  await requireContractAccess(cid);
  const m = await prisma.paymentMilestone.update({
    where: { id: milestoneId },
    data: { dueDate: null },
    select: { contractId: true },
  });
  revalidatePath(`/contracts/${m.contractId}`);
  revalidatePath("/calendar");
  revalidatePath("/");
  after(() => deleteMilestoneFromGoogle(milestoneId).catch(console.error));
}

export async function markPaymentDue(milestoneId: string) {
  const { contractId: cid } = await prisma.paymentMilestone.findUniqueOrThrow({
    where: { id: milestoneId },
    select: { contractId: true },
  });
  await requireContractAccess(cid);
  const m = await prisma.paymentMilestone.update({
    where: { id: milestoneId },
    data: { dueDate: new Date() },
    select: { contractId: true },
  });
  await prisma.contract.updateMany({
    where: { id: m.contractId, status: "DRAFT" },
    data: { status: "ACTIVE" },
  });
  revalidatePath(`/contracts/${m.contractId}`);
  revalidatePath("/calendar");
  revalidatePath("/");
  after(() => syncMilestoneToGoogle(milestoneId).catch(console.error));
}

export async function togglePayment(milestoneId: string, formData: FormData) {
  const { contractId: cid } = await prisma.paymentMilestone.findUniqueOrThrow({
    where: { id: milestoneId },
    select: { contractId: true },
  });
  await requireContractAccess(cid);
  const { paid } = markPaidSchema.parse({ paid: formData.get("paid") });

  const m = await prisma.paymentMilestone.update({
    where: { id: milestoneId },
    data:
      paid === "true"
        ? { status: "PAID", paidDate: new Date() }
        : { status: "PENDING", paidDate: null },
    select: { contractId: true },
  });
  if (paid === "true") {
    await prisma.contract.updateMany({
      where: { id: m.contractId, status: "DRAFT" },
      data: { status: "ACTIVE" },
    });
  }
  revalidatePath(`/contracts/${m.contractId}`);
  revalidatePath("/");
  revalidatePath("/contracts");
  if (paid === "true") {
    after(() => deleteMilestoneFromGoogle(milestoneId).catch(console.error));
  } else {
    after(() => syncMilestoneToGoogle(milestoneId).catch(console.error));
  }
}

const costSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.coerce.number().positive(),
});

export async function addProjectCost(contractId: string, formData: FormData) {
  await requireContractAccess(contractId);
  const data = costSchema.parse({
    label: formData.get("label"),
    amount: formData.get("amount"),
  });
  await prisma.projectCost.create({
    data: { contractId, label: data.label.trim(), amount: new Prisma.Decimal(data.amount) },
  });
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/");
}

export async function deleteProjectCost(costId: string) {
  const cost = await prisma.projectCost.findUniqueOrThrow({
    where: { id: costId },
    select: { contractId: true },
  });
  await requireContractAccess(cost.contractId);
  await prisma.projectCost.delete({ where: { id: costId } });
  revalidatePath(`/contracts/${cost.contractId}`);
  revalidatePath("/");
}

