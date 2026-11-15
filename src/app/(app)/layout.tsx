// Pages need the signed-in user and Supabase env at request time, never at build time.
export const dynamic = "force-dynamic";

import Link from "next/link";
import { signOut } from "../login/actions";
import { NavLinks } from "@/components/NavLinks";
import { Sidebar } from "@/components/Sidebar";

/**
 * The workspace shell. Desktop (lg and up): a left sidebar (Dashboard, master resume, recent jobs,
 * search, usage, account). Below lg: a slim header and the bottom tab bar (Dashboard, Master, Account).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-dvh border-r border-border bg-surface">
        <Sidebar />
      </aside>
      <div className="min-w-0 flex-1 pb-16 lg:pb-0">
        <header className="lg:hidden border-b border-border bg-surface sticky top-0 z-20">
          <div className="mx-auto max-w-7xl px-4 h-12 sm:h-14 flex items-center gap-6">
            <Link href="/" className="font-semibold">Job Pipeline</Link>
            <div className="ml-auto flex items-center gap-4 text-sm">
              <form action={signOut}>
                <button className="text-muted hover:text-fg">Sign out</button>
              </form>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-3 sm:px-4 lg:px-6 py-4 sm:py-6">{children}</main>
        {/* Bottom tab bar below lg */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
          <NavLinks mobile />
        </div>
      </div>
    </div>
  );
}
