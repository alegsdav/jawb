// Pages need the signed-in user and Supabase env at request time, never at build time.
export const dynamic = "force-dynamic";

import Link from "next/link";
import { signOut } from "../login/actions";
import { NavLinks } from "@/components/NavLinks";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh pb-16 sm:pb-0">
      <header className="border-b border-border bg-surface sticky top-0 z-20">
        <div className="mx-auto max-w-7xl px-4 h-12 sm:h-14 flex items-center gap-6">
          <Link href="/" className="font-semibold">Job Pipeline</Link>
          <div className="hidden sm:block">
            <NavLinks />
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <Link href="/account" className="hidden sm:inline text-muted hover:text-fg">Account</Link>
            <form action={signOut}>
              <button className="text-muted hover:text-fg">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6">{children}</main>
      {/* Bottom tab bar on phones */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
        <NavLinks mobile />
      </div>
    </div>
  );
}
