// Pages need the signed-in user and Supabase env at request time, never at build time.
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

/** The workspace shell: AppShell holds the sidebar's collapsed state, read here from the cookie so it renders right first time. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
  return <AppShell initialCollapsed={collapsed}>{children}</AppShell>;
}
