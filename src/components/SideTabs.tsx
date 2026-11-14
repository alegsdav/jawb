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
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-2 text-sm -mb-px border-b-2 min-h-10 sm:min-h-0 ${
            value === t.key ? "border-accent text-fg font-medium" : "border-transparent text-muted hover:text-fg"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
