import type { ReactNode } from "react";

/**
 * Dashboard building blocks, so every section reads as one system: a bordered white panel with a header row
 * (tinted icon, title, count, optional action on the right), a company monogram and a soft tinted pill.
 */

export type Tint = "blue" | "orange" | "green" | "violet" | "red" | "grey";

/** Background + foreground classes for each tint (tokens in globals.css). */
export const TINT: Record<Tint, string> = {
  blue: "bg-tint-blue text-tint-blue-fg",
  orange: "bg-tint-orange text-tint-orange-fg",
  green: "bg-tint-green text-tint-green-fg",
  violet: "bg-tint-violet text-tint-violet-fg",
  red: "bg-tint-red text-tint-red-fg",
  grey: "bg-surface-2 text-muted",
};

/** A white panel with a hairline border and soft shadow. `flush` drops the inner padding (for lists that run edge to edge). */
export function Panel({
  children, className = "", flush = false, as: Tag = "section", ...rest
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
  as?: "section" | "div";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`panel ${flush ? "" : "p-4 sm:p-5"} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** A panel's header row: tinted icon, title, count pill, then `action` on the right. */
export function PanelHeader({
  icon, tint = "grey", title, id, count, action, className = "",
}: {
  icon?: ReactNode;
  tint?: Tint;
  title: ReactNode;
  id?: string;
  count?: number;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-8 items-center gap-2.5 ${className}`}>
      {icon && (
        <span aria-hidden className={`inline-grid h-7 w-7 shrink-0 place-items-center rounded-lg ${TINT[tint]} [&_svg]:h-4 [&_svg]:w-4`}>
          {icon}
        </span>
      )}
      <h2 id={id} className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {typeof count === "number" && (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted">{count}</span>
      )}
      {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** A soft tinted pill ("Due today", "Strong fit"…). */
export function Pill({ tint = "grey", children, className = "" }: { tint?: Tint; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TINT[tint]} ${className}`}>
      {children}
    </span>
  );
}

const MARK_TINTS: Tint[] = ["blue", "orange", "green", "violet", "red"];

/** Same company, same colour, every time. */
function tintFor(name: string): Tint {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MARK_TINTS[h % MARK_TINTS.length];
}

/** A rounded square with the company's first letter, in a colour picked from its name. */
export function CompanyMark({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const label = (name ?? "").trim();
  const letter = label ? label[0].toUpperCase() : "?";
  const dims = size === "sm" ? "h-7 w-7 text-xs rounded-md" : size === "lg" ? "h-10 w-10 text-[15px] rounded-xl" : "h-9 w-9 text-[13px] rounded-lg";
  return (
    <span aria-hidden className={`inline-grid shrink-0 place-items-center font-semibold ${dims} ${label ? TINT[tintFor(label)] : TINT.grey}`}>
      {letter}
    </span>
  );
}
