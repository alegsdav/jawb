"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DocIcon, HomeIcon, UserIcon } from "./icons";

const LINKS = [
  { href: "/", label: "Dashboard", short: "Dashboard", desktop: true, Icon: HomeIcon },
  { href: "/resume", label: "Master resume", short: "Master", desktop: true, Icon: DocIcon },
  // On desktop (lg and up) the sidebar has all three; this is the tab bar below lg.
  { href: "/account", label: "Account", short: "Account", desktop: false, Icon: UserIcon },
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
            aria-current={isActive(l.href) ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive(l.href) ? "text-fg font-medium" : "text-muted"}`}
          >
            <l.Icon className="h-[18px] w-[18px]" />
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
