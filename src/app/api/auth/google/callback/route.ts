import { NextRequest, NextResponse, after } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/db";
import { backfillUserCalendar } from "@/lib/google-calendar";

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${process.env.AUTH_URL}/api/auth/google/callback`
  );
}

const base = () => process.env.AUTH_URL ?? "https://www.fonkapp.com";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const userId = searchParams.get("state");

  if (!code || !userId) {
    return NextResponse.redirect(`${base()}/profile?error=google_auth_failed`);
  }

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${base()}/profile?error=no_refresh_token`);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { googleRefreshToken: tokens.refresh_token },
    });

    // Events created before this moment were never pushed to this user, so
    // send everything upcoming now rather than making them wait for the next edit.
    after(() => backfillUserCalendar(userId).catch(console.error));

    return NextResponse.redirect(`${base()}/profile?success=google_connected`);
  } catch {
    return NextResponse.redirect(`${base()}/profile?error=google_auth_failed`);
  }
}
