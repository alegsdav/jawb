import Link from "next/link";
import { signOut } from "../login/actions";
import { NavLinks } from "@/components/NavLinks";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
          <Link href="/" className="font-semibold">Job Pipeline</Link>
          <NavLinks />
          <form action={signOut} className="ml-auto">
            <button className="text-sm text-muted hover:text-fg">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
