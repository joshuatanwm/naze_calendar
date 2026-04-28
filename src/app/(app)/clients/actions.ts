"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireOwner, requireUser } from "@/lib/permissions";

const CLIENT_STATUSES = ["NEW", "FIRST_APPOINTMENT", "SECOND_APPOINTMENT", "PENDING", "CLOSED", "BLNT"] as const;

const clientSchema = z.object({
  name:         z.string().min(1, "Name is required").max(200),
  email:        z.string().email().or(z.literal("")).optional(),
  phone:        z.string().max(50).optional(),
  address:      z.string().max(500).optional(),
  notes:        z.string().max(2000).optional(),
  assignedToId: z.string().optional(),
  clientStatus: z.enum(CLIENT_STATUSES).default("NEW"),
});

function clean(s: string | undefined | null) {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
}

function buildPayload(formData: FormData) {
  return {
    name:         formData.get("name"),
    email:        formData.get("email") ?? "",
    phone:        formData.get("phone") ?? "",
    address:      formData.get("address") ?? "",
    notes:        formData.get("notes") ?? "",
    assignedToId: formData.get("assignedToId") ?? "",
    clientStatus: formData.get("clientStatus") ?? "NEW",
  };
}

export async function createClient(formData: FormData) {
  const user = await requireUser();
  const parsed = clientSchema.parse(buildPayload(formData));

  const client = await prisma.client.create({
    data: {
      name:         parsed.name.trim(),
      email:        clean(parsed.email),
      phone:        clean(parsed.phone),
      address:      clean(parsed.address),
      notes:        clean(parsed.notes),
      assignedToId: clean(parsed.assignedToId),
      clientStatus: parsed.clientStatus,
      createdById:  user.id,
    },
  });
  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

export async function updateClient(id: string, formData: FormData) {
  await requireUser();
  const parsed = clientSchema.parse(buildPayload(formData));

  await prisma.client.update({
    where: { id },
    data: {
      name:         parsed.name.trim(),
      email:        clean(parsed.email),
      phone:        clean(parsed.phone),
      address:      clean(parsed.address),
      notes:        clean(parsed.notes),
      assignedToId: clean(parsed.assignedToId),
      clientStatus: parsed.clientStatus,
    },
  });
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}`);
}

export async function toggleProposalSent(id: string) {
  await requireUser();
  const client = await prisma.client.findUniqueOrThrow({
    where: { id },
    select: { proposalSent: true },
  });
  await prisma.client.update({
    where: { id },
    data: { proposalSent: !client.proposalSent },
  });
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function deleteClient(id: string) {
  await requireOwner();
  await prisma.client.delete({ where: { id } });
  revalidatePath("/clients");
  redirect("/clients");
}
