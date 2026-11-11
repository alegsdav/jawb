"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Tracker", short: "Tracker" },
  { href: "/resume", label: "Master resume", short: "Resume" },
  { href: "/bank", label: "Bullet bank", short: "Bank" },
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
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={isActive(l.href) ? "text-fg font-medium" : "text-muted hover:text-fg"}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
