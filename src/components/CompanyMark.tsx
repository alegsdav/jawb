/** A grey round monogram for a company, like the task icons in the reference. */
export function CompanyMark({ name, className = "" }: { name: string; className?: string }) {
  const clean = name.trim();
  return (
    <span aria-hidden className={`icon-chip text-sm font-semibold ${className}`}>
      {clean ? clean[0].toUpperCase() : "·"}
    </span>
  );
}
