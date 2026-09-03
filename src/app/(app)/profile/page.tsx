import Link from "next/link";
import { requireUser } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { updateProfile, changePassword, disconnectGoogle, resyncGoogleCalendar } from "./actions";

type Props = {
  searchParams: Promise<{ success?: string; error?: string; events?: string; milestones?: string }>;
};

export default async function ProfilePage({ searchParams }: Props) {
  const user = await requireUser();
  const { success, error, events, milestones } = await searchParams;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { googleRefreshToken: true },
  });
  const googleConnected = !!dbUser?.googleRefreshToken;

  const errorMessage =
    error === "wrong_password"
      ? "Current password is incorrect."
      : error === "invalid_name"
        ? "Name is required."
        : error === "google_auth_failed"
          ? "Google authorisation failed. Please try again."
          : error === "no_refresh_token"
            ? "Google didn't return a refresh token. Please try again."
            : error
              ? decodeURIComponent(error)
              : null;

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-warm-500">{user.email}</p>
      </div>

      {errorMessage && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Edit profile</h2>
        {success === "profile" && (
          <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
            Name updated.
          </p>
        )}
        <form action={updateProfile} className="space-y-4">
          <div>
            <label htmlFor="name" className="label">Name</label>
            <input id="name" name="name" required defaultValue={user.name} className="input" />
          </div>
          <div>
            <label className="label">Email</label>
            <input value={user.email} readOnly disabled className="input bg-brand-50" />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="btn-primary">Save changes</button>
          </div>
        </form>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Google Calendar</h2>
        {success === "google_connected" && (
          <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
            Google Calendar connected successfully.
          </p>
        )}
        {success === "google_resync" && (
          <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
            {Number(events ?? 0) + Number(milestones ?? 0) > 0
              ? "Synced " + events + " event(s) and " + milestones + " payment date(s) to your Google Calendar."
              : "Everything upcoming is already on your Google Calendar."}
          </p>
        )}
        {success === "google_disconnected" && (
          <p className="rounded-md bg-brand-50 px-4 py-3 text-sm text-brand-700">
            Google Calendar disconnected.
          </p>
        )}
        <p className="text-sm text-warm-600">
          {googleConnected
            ? "Your Google Calendar is connected. Events and payment milestones assigned to you sync automatically. Use “Sync upcoming events now” if something is missing."
            : "Connect your Google Calendar to automatically receive events and payment due dates."}
        </p>
        <div className="flex items-center gap-3">
          {googleConnected ? (
            <>
              <span className="text-sm text-green-700 font-medium">● Connected</span>
              <form action={resyncGoogleCalendar}>
                <button type="submit" className="btn-secondary text-sm">Sync upcoming events now</button>
              </form>
              <form action={disconnectGoogle}>
                <button type="submit" className="btn-secondary text-sm">Disconnect</button>
              </form>
            </>
          ) : (
            <Link href="/api/auth/google" className="btn-primary">
              Connect Google Calendar
            </Link>
          )}
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Change password</h2>
        <form action={changePassword} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className="label">Current password</label>
            <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className="input" />
          </div>
          <div>
            <label htmlFor="newPassword" className="label">New password</label>
            <input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" className="input" />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="label">Confirm new password</label>
            <input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" className="input" />
          </div>
          <p className="text-xs text-warm-500">You will be signed out after changing your password.</p>
          <div className="flex justify-end">
            <button type="submit" className="btn-primary">Change password</button>
          </div>
        </form>
      </div>
    </div>
  );
}
