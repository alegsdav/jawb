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
    <div role="tablist" aria-label={label} className="flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`rounded-full px-3.5 py-1.5 text-sm min-h-10 sm:min-h-0 transition-colors ${
            value === t.key ? "bg-surface-2 text-fg font-medium" : "text-muted hover:text-fg"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
