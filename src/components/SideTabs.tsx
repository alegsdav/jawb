"use client";

/** Tabs at the top of the editor's right panel ("Coach" / "Facts"). */
export function SideTabs<T extends string>({
  tabs, value, onChange, label,
}: {
  tabs: { key: T; label: React.ReactNode }[];
  value: T;
  onChange: (t: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-2xl bg-surface-2 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`flex-1 rounded-xl px-3 py-1.5 text-sm min-h-10 sm:min-h-0 transition-colors ${
            value === t.key ? "bg-surface text-accent font-semibold shadow-[var(--shadow-card)]" : "text-muted hover:text-fg"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
