const TINTS = [
  ["var(--tint-blue)", "var(--tint-blue-fg)"],
  ["var(--tint-peach)", "var(--tint-peach-fg)"],
  ["var(--tint-mint)", "var(--tint-mint-fg)"],
  ["var(--tint-rose)", "var(--tint-rose-fg)"],
] as const;

/** A round pastel monogram for a company: same company, same colour, every time. */
export function CompanyMark({ name, className = "" }: { name: string; className?: string }) {
  const clean = name.trim();
  let h = 0;
  for (const ch of clean) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = TINTS[h % TINTS.length];
  return (
    <span aria-hidden className={`icon-chip text-sm font-bold ${className}`} style={{ background: bg, color: fg }}>
      {clean ? clean[0].toUpperCase() : "·"}
    </span>
  );
}
