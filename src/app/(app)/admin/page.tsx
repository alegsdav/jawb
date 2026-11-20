import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { AdminQuotas } from "@/components/AdminQuotas";

export const metadata: Metadata = { title: "AI limits · Jawb" };

export default async function AdminPage() {
  const { user } = await requireUser();
  if (!isAdminEmail(user?.email)) notFound();
  return (
    <div className="px-4 sm:px-6 lg:px-10 py-5 sm:py-8 space-y-4">
      <h1 className="text-xl font-semibold">AI limits</h1>
      <AdminQuotas />
    </div>
  );
}
