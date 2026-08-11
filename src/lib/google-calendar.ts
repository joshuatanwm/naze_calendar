import { google } from "googleapis";
import { prisma } from "./db";
import { formatMoney } from "./format";

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${process.env.AUTH_URL}/api/auth/google/callback`
  );
}

export function getGoogleAuthUrl(userId: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state: userId,
  });
}

async function calendarForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleRefreshToken: true },
  });
  if (!user?.googleRefreshToken) return null;

  const client = oauthClient();
  client.setCredentials({ refresh_token: user.googleRefreshToken });
  client.on("tokens", async (tokens) => {
    if (tokens.refresh_token) {
      await prisma.user.update({
        where: { id: userId },
        data: { googleRefreshToken: tokens.refresh_token },
      });
    }
  });
  return google.calendar({ version: "v3", auth: client });
}

async function connectedOwners() {
  return prisma.user.findMany({
    where: { role: "OWNER", active: true, googleRefreshToken: { not: null } },
    select: { id: true },
  });
}

export async function syncEventToGoogle(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      client: true,
      assignments: { include: { user: { select: { id: true } } } },
      ownerSyncs: true,
    },
  });
  if (!event) return;

  const end = new Date(event.startAt.getTime() + 60 * 60 * 1000);
  const body = {
    summary: event.title,
    description: [event.description, event.client ? `Client: ${event.client.name}` : ""]
      .filter(Boolean).join("\n"),
    location: event.location ?? undefined,
    start: { dateTime: event.startAt.toISOString(), timeZone: "Asia/Singapore" },
    end: { dateTime: end.toISOString(), timeZone: "Asia/Singapore" },
  };

  // Sync to assigned employees
  for (const { userId, googleEventId } of event.assignments) {
    try {
      const cal = await calendarForUser(userId);
      if (!cal) continue;
      if (googleEventId) {
        await cal.events.update({ calendarId: "primary", eventId: googleEventId, requestBody: body });
      } else {
        const res = await cal.events.insert({ calendarId: "primary", requestBody: body });
        if (res.data.id) {
          await prisma.eventAssignment.update({
            where: { eventId_userId: { eventId, userId } },
            data: { googleEventId: res.data.id },
          });
        }
      }
    } catch (err) {
      console.error(`syncEventToGoogle (assigned) failed for user ${userId}:`, err);
    }
  }

  // Sync to all connected owners
  const assignedIds = new Set(event.assignments.map((a) => a.userId));
  const owners = await connectedOwners();
  for (const { id: userId } of owners) {
    if (assignedIds.has(userId)) continue;
    try {
      const cal = await calendarForUser(userId);
      if (!cal) continue;
      const existing = event.ownerSyncs.find((s) => s.userId === userId);
      if (existing) {
        await cal.events.update({ calendarId: "primary", eventId: existing.googleEventId, requestBody: body });
      } else {
        const res = await cal.events.insert({ calendarId: "primary", requestBody: body });
        if (res.data.id) {
          await prisma.eventOwnerSync.create({ data: { eventId, userId, googleEventId: res.data.id } });
        }
      }
    } catch (err) {
      console.error(`syncEventToGoogle (owner) failed for user ${userId}:`, err);
    }
  }
}

export async function removeAssignmentFromGoogle(userId: string, googleEventId: string) {
  try {
    const cal = await calendarForUser(userId);
    if (!cal) return;
    await cal.events.delete({ calendarId: "primary", eventId: googleEventId });
  } catch (err) {
    console.error(`removeAssignmentFromGoogle failed for user ${userId}:`, err);
  }
}

export async function deleteEventFromGoogle(eventId: string) {
  const [assignments, ownerSyncs] = await Promise.all([
    prisma.eventAssignment.findMany({ where: { eventId } }),
    prisma.eventOwnerSync.findMany({ where: { eventId } }),
  ]);

  for (const { userId, googleEventId } of assignments) {
    if (!googleEventId) continue;
    try {
      const cal = await calendarForUser(userId);
      if (!cal) continue;
      await cal.events.delete({ calendarId: "primary", eventId: googleEventId });
    } catch (err) {
      console.error(`deleteEventFromGoogle (assigned) failed for user ${userId}:`, err);
    }
  }

  for (const { userId, googleEventId } of ownerSyncs) {
    try {
      const cal = await calendarForUser(userId);
      if (!cal) continue;
      await cal.events.delete({ calendarId: "primary", eventId: googleEventId });
    } catch (err) {
      console.error(`deleteEventFromGoogle (owner) failed for user ${userId}:`, err);
    }
  }
}

export async function syncMilestoneToGoogle(milestoneId: string) {
  const milestone = await prisma.paymentMilestone.findUnique({
    where: { id: milestoneId },
    include: {
      contract: { include: { client: true, assignments: true } },
      googleSync: true,
    },
  });
  if (!milestone?.dueDate) return;

  const dateStr = milestone.dueDate.toISOString().split("T")[0];
  const body = {
    summary: `Payment Due — ${milestone.contract.title} · ${milestone.label}`,
    description: `Amount: ${formatMoney(milestone.amount)}\nClient: ${milestone.contract.client.name}`,
    start: { date: dateStr },
    end: { date: dateStr },
  };

  const assignedIds = new Set(milestone.contract.assignments.map((a) => a.userId));
  const owners = await connectedOwners();
  const allUserIds = [
    ...milestone.contract.assignments.map((a) => a.userId),
    ...owners.map((o) => o.id).filter((id) => !assignedIds.has(id)),
  ];

  for (const userId of allUserIds) {
    try {
      const cal = await calendarForUser(userId);
      if (!cal) continue;
      const existing = milestone.googleSync.find((s) => s.userId === userId);
      if (existing) {
        await cal.events.update({ calendarId: "primary", eventId: existing.googleEventId, requestBody: body });
      } else {
        const res = await cal.events.insert({ calendarId: "primary", requestBody: body });
        if (res.data.id) {
          await prisma.milestoneSync.create({ data: { milestoneId, userId, googleEventId: res.data.id } });
        }
      }
    } catch (err) {
      console.error(`syncMilestoneToGoogle failed for user ${userId}:`, err);
    }
  }
}

export async function deleteMilestoneFromGoogle(milestoneId: string) {
  const syncs = await prisma.milestoneSync.findMany({ where: { milestoneId } });
  for (const { userId, googleEventId } of syncs) {
    try {
      const cal = await calendarForUser(userId);
      if (!cal) continue;
      await cal.events.delete({ calendarId: "primary", eventId: googleEventId });
    } catch (err) {
      console.error(`deleteMilestoneFromGoogle failed for user ${userId}:`, err);
    }
  }
  await prisma.milestoneSync.deleteMany({ where: { milestoneId } });
}
