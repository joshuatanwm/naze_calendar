"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { signOut } from "@/lib/auth";
import { backfillUserCalendar } from "@/lib/google-calendar";

const profileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function updateProfile(formData: FormData) {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) redirect("/profile?error=invalid_name");

  await prisma.user.update({
    where: { id: user.id },
    data: { name: parsed.data.name.trim() },
  });

  redirect("/profile?success=profile");
}

export async function disconnectGoogle() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { googleRefreshToken: null },
  });
  redirect("/profile?success=google_disconnected");
}

export async function resyncGoogleCalendar() {
  const user = await requireUser();
  const { events, milestones } = await backfillUserCalendar(user.id);
  redirect(
    "/profile?success=google_resync&events=" + events + "&milestones=" + milestones
  );
}

export async function changePassword(formData: FormData) {
  const user = await requireUser();

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const msg = parsed.error.errors[0]?.message ?? "invalid";
    redirect(`/profile?error=${encodeURIComponent(msg)}`);
  }

  const record = await prisma.user.findUnique({ where: { id: user.id } });
  if (!record) redirect("/login");

  const ok = await bcrypt.compare(parsed.data.currentPassword, record.passwordHash);
  if (!ok) redirect("/profile?error=wrong_password");

  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

  await signOut({ redirectTo: "/login?success=password_changed" });
}
