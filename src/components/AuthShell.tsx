import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/icons";

// Shared layout for the sign-in and sign-up pages. Phone sizes by default; the lg: (1024px+) overrides are the desktop
// artboard. Field focus rings live in globals.css (.login-field), because the global :focus-visible rule would
// otherwise win over a utility class.
export const FIELD =
  "login-field h-12 w-full rounded-lg bg-fg/[0.04] px-3.5 text-base text-fg placeholder:text-muted focus:bg-fg/[0.06] lg:h-11 lg:text-[15px]";
export const SUBMIT =
  "flex h-12 w-full items-center justify-center rounded-full bg-accent text-base font-medium text-[#f4f4f5] transition-colors hover:bg-[#2a2a94] disabled:cursor-progress lg:h-11 lg:text-[15px]";
export const LABEL = "flex flex-col gap-1.5 text-[13px] font-medium text-[#525252]";

/** The one-line link under the wordmark (lg) or at the bottom (phones): "Have an invite code? Create your account". */
export function AuthTopLink({ lead, href, children }: { lead: string; href: string; children: ReactNode }) {
  return (
    <p className="text-[13px] text-muted">
      {lead}{" "}
      <Link href={href} className="text-fg underline underline-offset-2">
        {children}
      </Link>
    </p>
  );
}

/**
 * The grey-framed white canvas shared by the auth pages. `topLink` shows top-right on lg and at the bottom on phones.
 * `children` is the form, centred in the left column. `preview` is the decorative right column (lg and up), passed in
 * so it can stay a server component.
 */
export function AuthShell({ topLink, preview, children }: { topLink: ReactNode; preview?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-chrome p-2">
      <div className="grid min-h-[calc(100dvh-1rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.04)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col justify-between px-[22px] pt-6 pb-8 lg:px-14 lg:pt-10">
          <div className="flex items-center justify-between gap-4">
            <Wordmark className="text-[24px] lg:text-[26px]" />
            <div className="hidden lg:block">{topLink}</div>
          </div>

          <div className="flex flex-1 items-center justify-center py-10">{children}</div>

          <div className="flex flex-col gap-3">
            <div className="lg:hidden">{topLink}</div>
            <p className="text-[12px] text-muted">Invite-only while in beta.</p>
          </div>
        </div>

        {preview}
      </div>
    </main>
  );
}
