// Pages need the signed-in user and Supabase env at request time, never at build time.
export const dynamic = "force-dynamic";

import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import { Sidebar } from "@/components/Sidebar";
import { Logo } from "@/components/icons";
import { signOut } from "../login/actions";

/**
 * The workspace shell. Desktop (lg and up): the window is the grey chrome, the sidebar sits on it, and
 * <main> is one white inset panel that scrolls on its own (the window itself never scrolls). Below lg:
 * a slim header and the bottom tab bar, with main as plain full-width white.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex lg:h-dvh lg:overflow-hidden">
      <aside className="hidden lg:block lg:w-[232px] lg:shrink-0 lg:sticky lg:top-0 lg:h-dvh">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
        <header className="lg:hidden border-b border-border bg-surface sticky top-0 z-20">
          <div className="mx-auto max-w-7xl px-4 h-12 sm:h-14 flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-semibold"><Logo size={22} />Job Pipeline</Link>
            <div className="ml-auto flex items-center gap-4 text-sm">
              <form action={signOut}>
                <button className="text-muted hover:text-fg">Sign out</button>
              </form>
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 bg-surface lg:my-2 lg:mr-2 lg:h-[calc(100dvh-1rem)] lg:overflow-y-auto lg:flex-none lg:rounded-xl lg:border lg:border-border lg:shadow-[0_1px_3px_rgb(0_0_0/0.04)]">
          {children}
        </main>
        {/* Bottom tab bar below lg */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
          <NavLinks mobile />
        </div>
      </div>
    </div>
  );
}
