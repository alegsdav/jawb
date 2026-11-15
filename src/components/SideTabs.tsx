"use client";

/** Quiet text tabs ("Coach" / "Facts"): small type, the active tab gets a 1.5px underline. */
export function SideTabs<T extends string>({
  tabs, value, onChange, label,
}: {
  tabs: { key: T; label: React.ReactNode }[];
  value: T;
  onChange: (t: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-4 border-b border-border">
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`-mb-px min-h-10 border-b-[1.5px] px-0.5 text-[13px] transition-colors sm:min-h-0 sm:py-2 ${
              active ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
