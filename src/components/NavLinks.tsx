"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Tracker", short: "Tracker", desktop: true },
  { href: "/resume", label: "Master resume", short: "Master", desktop: true },
  // On desktop, Account lives in the header's top-right corner instead.
  { href: "/account", label: "Account", short: "Account", desktop: false },
];

export function NavLinks({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" || path.startsWith("/jobs") : path.startsWith(href));

  if (mobile) {
    return (
      <nav className="grid grid-cols-3">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`py-3 text-center text-sm ${isActive(l.href) ? "text-accent font-semibold" : "text-muted"}`}
          >
            {l.short}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="flex gap-4 text-sm">
      {LINKS.filter((l) => l.desktop).map((l) => (
        <Link key={l.href} href={l.href} className={isActive(l.href) ? "text-fg font-medium" : "text-muted hover:text-fg"}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
