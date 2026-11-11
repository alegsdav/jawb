"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Tracker" },
  { href: "/resume", label: "Master resume" },
  { href: "/bank", label: "Bullet bank" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex gap-4 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" || path.startsWith("/jobs") : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? "text-fg font-medium" : "text-muted hover:text-fg"}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
