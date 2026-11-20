import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { PasswordForm } from "@/components/PasswordForm";
import { UsageCard } from "@/components/UsageMeter";

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

      <PasswordForm />

      <div className="space-y-3 border-t border-border pt-4">
        <UsageCard />
        {isAdminEmail(user?.email) && (
          <Link href="/admin" className="block text-sm font-medium">
            Manage AI limits →
          </Link>
        )}
      </div>

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="font-semibold">Export your data</h2>
        <p className="text-sm text-muted">A JSON backup of your resumes, facts and jobs.</p>
        <a href="/api/export" download className="btn w-full py-2.5">
          Download backup (.json)
        </a>
      </section>
    </div>
  );
}
