// Pages need the signed-in user and Supabase env at request time, never at build time.
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { SIDEBAR_COOKIE, SIDEBAR_WIDTH_COOKIE, parseSidebarWidth } from "@/lib/sidebar";
import { createClient } from "@/lib/supabase/server";
import { accountFromUser } from "@/lib/account";

/**
 * The workspace shell: AppShell holds the sidebar's collapsed state and width, read here from the cookies so it renders
 * right first time, and the signed-in account's name and picture (the sidebar's profile button and the greeting).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const collapsed = jar.get(SIDEBAR_COOKIE)?.value === "1";
  const width = parseSidebarWidth(jar.get(SIDEBAR_WIDTH_COOKIE)?.value);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return (
    <AppShell initialCollapsed={collapsed} initialWidth={width} account={accountFromUser(data.user)}>
      {children}
    </AppShell>
  );
}
