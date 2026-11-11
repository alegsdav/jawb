"use client";

import { useEffect, useRef } from "react";
import type { Analysis, Bullet, Item, Resume, Section } from "@/lib/types";
import { emptyItem, emptySection, uid } from "@/lib/resume";

type Feedback = Analysis["bullets"][number];

type Props = {
  value: Resume;
  onChange: (r: Resume) => void;
  /** Per-bullet AI feedback, keyed by bullet id. */
  feedback?: Record<string, Feedback>;
  onDismissFeedback?: (bulletId: string) => void;
};

const RATING_STYLE: Record<Feedback["rating"], string> = {
  strong: "border-l-good bg-good-bg/60",
  ok: "border-l-ok bg-ok-bg/60",
  weak: "border-l-bad bg-bad-bg/60",
};

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} className={`resize-none overflow-hidden ${props.className ?? ""}`} />;
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="h-6 w-6 grid place-items-center rounded text-muted hover:text-fg hover:bg-border/60 text-xs"
    >
      {children}
    </button>
  );
}

export function ResumeEditor({ value, onChange, feedback, onDismissFeedback }: Props) {
  const setSections = (sections: Section[]) => onChange({ ...value, sections });
  const updateSection = (si: number, patch: Partial<Section>) =>
    setSections(value.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  const updateItem = (si: number, ii: number, patch: Partial<Item>) =>
    updateSection(si, { items: value.sections[si].items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) });
  const setBullets = (si: number, ii: number, bullets: Bullet[]) => updateItem(si, ii, { bullets });

  return (
    <div className="card p-5 space-y-6">
      <div className="text-center space-y-1">
        <input
          className="ghost-input w-full text-center text-2xl font-semibold"
          value={value.header.name}
          placeholder="Your name"
          onChange={(e) => onChange({ ...value, header: { ...value.header, name: e.target.value } })}
        />
        <input
          className="ghost-input w-full text-center text-sm text-muted"
          value={value.header.contact}
          placeholder="Location • email • phone • links"
          onChange={(e) => onChange({ ...value, header: { ...value.header, contact: e.target.value } })}
        />
      </div>

      {value.sections.map((section, si) => (
        <section key={section.id} className="group/section">
          <div className="flex items-center gap-1 border-b border-border pb-1 mb-2">
            <input
              className="ghost-input flex-1 font-semibold uppercase tracking-wide text-sm"
              value={section.title}
              onChange={(e) => updateSection(si, { title: e.target.value })}
            />
            <div className="flex opacity-0 group-hover/section:opacity-100 focus-within:opacity-100">
              <IconBtn title="Move section up" onClick={() => setSections(move(value.sections, si, -1))}>↑</IconBtn>
              <IconBtn title="Move section down" onClick={() => setSections(move(value.sections, si, 1))}>↓</IconBtn>
              <IconBtn
                title="Delete section"
                onClick={() => confirm(`Delete "${section.title}"?`) && setSections(value.sections.filter((_, i) => i !== si))}
              >✕</IconBtn>
            </div>
          </div>

          <div className="space-y-3">
            {section.items.map((item, ii) => (
              <div key={item.id} className="group/item rounded-lg -mx-2 px-2 py-1 hover:bg-bg/60">
                <div className="flex items-start gap-1">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-x-2">
                    <input
                      className="ghost-input font-medium text-sm"
                      value={item.title}
                      placeholder="Role / degree / category"
                      onChange={(e) => updateItem(si, ii, { title: e.target.value })}
                    />
                    <input
                      className="ghost-input text-sm text-muted sm:text-right sm:w-40"
                      value={item.dates}
                      placeholder="Dates"
                      onChange={(e) => updateItem(si, ii, { dates: e.target.value })}
                    />
                    <input
                      className="ghost-input text-sm italic"
                      value={item.subtitle}
                      placeholder="Organization / details"
                      onChange={(e) => updateItem(si, ii, { subtitle: e.target.value })}
                    />
                    <input
                      className="ghost-input text-sm text-muted sm:text-right sm:w-40"
                      value={item.location}
                      placeholder="Location"
                      onChange={(e) => updateItem(si, ii, { location: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
                    <IconBtn title="Move entry up" onClick={() => updateSection(si, { items: move(section.items, ii, -1) })}>↑</IconBtn>
                    <IconBtn title="Move entry down" onClick={() => updateSection(si, { items: move(section.items, ii, 1) })}>↓</IconBtn>
                    <IconBtn
                      title="Delete entry"
                      onClick={() => updateSection(si, { items: section.items.filter((_, i) => i !== ii) })}
                    >✕</IconBtn>
                  </div>
                </div>

                <ul className="mt-1 space-y-1">
                  {item.bullets.map((b, bi) => {
                    const fb = feedback?.[b.id];
                    return (
                      <li
                        key={b.id}
                        className={`group/bullet flex items-start gap-1 rounded border-l-4 pl-1 ${fb ? RATING_STYLE[fb.rating] : "border-l-transparent"}`}
                      >
                        <span className="pt-1 text-muted select-none">•</span>
                        <div className="flex-1 min-w-0">
                          <AutoTextarea
                            className="ghost-input w-full text-sm leading-snug"
                            value={b.text}
                            placeholder="Accomplishment: verb + what + impact (number)"
                            onChange={(e) =>
                              setBullets(si, ii, item.bullets.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                const next = [...item.bullets];
                                next.splice(bi + 1, 0, { id: uid(), text: "" });
                                setBullets(si, ii, next);
                              }
                            }}
                          />
                          {fb && (
                            <div className="px-1 pb-1 text-xs space-y-1">
                              <p>
                                <span className={`font-semibold uppercase ${fb.rating === "strong" ? "text-good" : fb.rating === "ok" ? "text-ok" : "text-bad"}`}>
                                  {fb.rating}
                                </span>{" "}
                                <span className="text-muted">{fb.note}</span>
                              </p>
                              {fb.rewrite && fb.rewrite !== b.text && (
                                <div className="rounded border border-border bg-surface p-2 space-y-1.5">
                                  <p className="text-fg">{fb.rewrite}</p>
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-primary"
                                      onClick={() =>
                                        setBullets(si, ii, item.bullets.map((x) => (x.id === b.id ? { ...x, text: fb.rewrite } : x)))
                                      }
                                    >
                                      Use rewrite
                                    </button>
                                    {onDismissFeedback && (
                                      <button type="button" className="btn btn-sm" onClick={() => onDismissFeedback(b.id)}>
                                        Dismiss
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex opacity-0 group-hover/bullet:opacity-100 focus-within:opacity-100">
                          <IconBtn title="Move bullet up" onClick={() => setBullets(si, ii, move(item.bullets, bi, -1))}>↑</IconBtn>
                          <IconBtn title="Move bullet down" onClick={() => setBullets(si, ii, move(item.bullets, bi, 1))}>↓</IconBtn>
                          <IconBtn title="Delete bullet" onClick={() => setBullets(si, ii, item.bullets.filter((_, i) => i !== bi))}>✕</IconBtn>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className="text-xs text-muted hover:text-fg ml-4 opacity-0 group-hover/item:opacity-100 focus:opacity-100"
                  onClick={() => setBullets(si, ii, [...item.bullets, { id: uid(), text: "" }])}
                >
                  + bullet
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-muted hover:text-fg"
            onClick={() => updateSection(si, { items: [...section.items, emptyItem()] })}
          >
            + entry
          </button>
        </section>
      ))}

      <button type="button" className="btn btn-sm" onClick={() => setSections([...value.sections, emptySection()])}>
        + Add section
      </button>
    </div>
  );
}
