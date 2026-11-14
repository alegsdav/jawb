import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { PasswordForm } from "@/components/PasswordForm";
import { UsageCard } from "@/components/UsageMeter";

export const metadata: Metadata = { title: "Account · Job Pipeline" };

export default async function AccountPage() {
  const { user } = await requireUser();
  return (
    <div className="max-w-sm mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        {user?.email && (
          <p className="text-sm">
            Signed in as <strong className="break-all">{user.email}</strong>
          </p>
        )}
        <p className="text-sm text-muted">Set or change the password you sign in with.</p>
      </div>
      <PasswordForm />

      <UsageCard />

      <section className="card p-4 space-y-2">
        <h2 className="font-semibold">Export your data</h2>
        <p className="text-sm text-muted">
          Downloads a JSON backup of your master resume, your facts, every tailored copy, and every job you&apos;ve
          tracked.
        </p>
        <p className="text-xs text-muted">
          The backup is for safekeeping. There&apos;s no import button: restoring it is done by hand in Supabase.
        </p>
        <a href="/api/export" download className="btn w-full py-2.5">
          Download backup (.json)
        </a>
      </section>
    </div>
  );
}
