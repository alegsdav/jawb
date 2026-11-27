import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { profileNameFromMetadata } from "@/lib/account";
import { AccountNameForm } from "@/components/AccountNameForm";
import { PasswordForm } from "@/components/PasswordForm";
import { UsageCard } from "@/components/UsageMeter";
import { signOut } from "@/app/login/actions";

export const metadata: Metadata = { title: "Account · Jawb" };

export default async function AccountPage() {
  const { user } = await requireUser();
  return (
    <div className="max-w-lg mx-auto space-y-6 px-4 sm:px-6 lg:px-10 py-5 sm:py-8">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        {user?.email && (
          <p className="text-sm break-words">
            Signed in as <strong>{user.email}</strong>
          </p>
        )}
      </div>

      <section className="space-y-2" aria-labelledby="account-name">
        <h2 id="account-name" className="font-semibold">Name</h2>
        <p className="text-sm text-muted">Shown in your greeting and the sidebar. Up to 60 characters.</p>
        <AccountNameForm initialName={profileNameFromMetadata(user?.user_metadata)} />
      </section>

      <PasswordForm />

      <div className="space-y-3 border-t border-border pt-4">
        <UsageCard />
      </div>

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="font-semibold">Export your data</h2>
        <p className="text-sm text-muted">A JSON backup of your resumes, facts and jobs.</p>
        <a href="/api/export" download className="btn w-full py-2.5">
          Download backup (.json)
        </a>
      </section>

      <form action={signOut} className="border-t border-border pt-4">
        <button className="btn w-full py-2.5">Sign out</button>
      </form>
    </div>
  );
}
