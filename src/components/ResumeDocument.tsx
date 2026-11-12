"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Analysis, Bullet, Item, Resume, Section } from "@/lib/types";
import { emptyItem, isInlineItem, uid } from "@/lib/resume";

type Feedback = Analysis["bullets"][number];

type Props = {
  value: Resume;
  /** commit=true for structural edits so they become their own undo step. */
  onChange: (r: Resume, commit?: boolean) => void;
  /** AI feedback per bullet id. */
  feedback?: Record<string, Feedback>;
  showHighlights?: boolean;
  /** Bullet texts from the master resume, for change tracking. */
  baseline?: Map<string, string> | null;
  showChanges?: boolean;
  /** Bullet ids whose suggestion was rejected. */
  rejected?: Set<string>;
  onReject?: (bulletId: string) => void;
  /** Reports page count and roughly how many lines spill past page 1. */
  onMeasure?: (m: { pages: number; overflowLines: number }) => void;
  /** Element in the page toolbar where contextual actions (move/delete) render. */
  actionsSlot?: HTMLElement | null;
};

type Active =
  | { kind: "header" }
  | { kind: "section"; si: number }
  | { kind: "item"; si: number; ii: number }
  | { kind: "bullet"; si: number; ii: number; bi: number }
  | null;

// Letter page at 96dpi with 0.6in margins; matches the PDF export.
const PAGE_H = 1056;
const MARGIN = 58;
const LINE = 18;

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Text input that grows with its content (for right-aligned dates/locations and inline labels). */
function AutoInput({
  value, onChange, placeholder, className = "", inputClass = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  inputClass?: string;
}) {
  return (
    <span className={`inline-grid max-w-full ${className}`}>
      <span aria-hidden className="invisible whitespace-pre col-start-1 row-start-1 px-[2px]">
        {value || placeholder}
      </span>
      <input
        size={1}
        className={`doc-field col-start-1 row-start-1 w-full min-w-[1ch] ${inputClass}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </span>
  );
}

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  });
  return <textarea ref={ref} rows={1} {...props} className={`doc-field block w-full resize-none overflow-hidden ${props.className ?? ""}`} />;
}

function ToolBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.preventDefault()} // keep the caret where it is
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-xs whitespace-nowrap hover:bg-black/5 ${danger ? "text-[#c53030]" : "text-[#3c3c3a]"}`}
    >
      {label}
    </button>
  );
}

/**
 * Contextual move/delete actions for the focused section/entry/bullet.
 * Desktop: rendered into the page toolbar (like Docs). Phones: inline under what you're editing.
 */
function ContextBar({ slot, label, children }: { slot?: HTMLElement | null; label: string; children: React.ReactNode }) {
  const bar = (inline: boolean) => (
    <div
      className={`doc-ui flex flex-wrap items-center gap-0.5 ${
        inline ? "sm:hidden mt-2 rounded-lg border border-[#e2e2de] bg-[#fafaf8] px-1 py-1" : "hidden sm:flex"
      }`}
    >
      <span className="px-1.5 text-[11px] font-medium uppercase tracking-wide text-[#6b6b66]">{label}</span>
      {children}
    </div>
  );
  return (
    <>
      {slot && createPortal(bar(false), slot)}
      {bar(true)}
    </>
  );
}

const RATING: Record<Feedback["rating"], { label: string; tint: string; dot: string; text: string }> = {
  strong: { label: "Strong", tint: "bg-[#e9f6ee]", dot: "bg-[#1f8a4c]", text: "text-[#1f8a4c]" },
  ok: { label: "Okay", tint: "bg-[#fdf5e2]", dot: "bg-[#c98a12]", text: "text-[#a86f05]" },
  weak: { label: "Weak", tint: "bg-[#fdecec]", dot: "bg-[#c53030]", text: "text-[#c53030]" },
};

export function ResumeDocument({
  value, onChange, feedback, showHighlights = true, baseline, showChanges = true, rejected, onReject, onMeasure, actionsSlot,
}: Props) {
  const [active, setActive] = useState<Active>(null);
  const focusNext = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Focus a bullet created/removed by keyboard once it's rendered.
  useEffect(() => {
    if (!focusNext.current) return;
    const el = document.querySelector<HTMLTextAreaElement>(`[data-bullet="${focusNext.current}"]`);
    focusNext.current = null;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  // Page-length measurement.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !onMeasure) return;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth < 600) return; // reflowed phone layout isn't page-accurate
      const usable = PAGE_H - 2 * MARGIN;
      const h = el.scrollHeight;
      onMeasure({ pages: Math.max(1, Math.ceil(h / usable)), overflowLines: Math.max(0, Math.ceil((h - usable) / LINE)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);

  // ---- immutable update helpers ----
  const setSections = (sections: Section[], commit = false) => onChange({ ...value, sections }, commit);
  const updSection = (si: number, patch: Partial<Section>, commit = false) =>
    setSections(value.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)), commit);
  const updItem = (si: number, ii: number, patch: Partial<Item>, commit = false) =>
    updSection(si, { items: value.sections[si].items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) }, commit);
  const setBullets = (si: number, ii: number, bullets: Bullet[], commit = false) => updItem(si, ii, { bullets }, commit);

  function addBullet(si: number, ii: number, after: number) {
    const item = value.sections[si].items[ii];
    const b = { id: uid(), text: "" };
    const next = [...item.bullets];
    next.splice(after + 1, 0, b);
    focusNext.current = b.id;
    setBullets(si, ii, next, true);
  }

  function removeBullet(si: number, ii: number, bi: number) {
    const item = value.sections[si].items[ii];
    const prev = item.bullets[bi - 1];
    if (prev) focusNext.current = prev.id;
    setBullets(si, ii, item.bullets.filter((_, i) => i !== bi), true);
    setActive(prev ? { kind: "bullet", si, ii, bi: bi - 1 } : { kind: "item", si, ii });
  }

  const isActiveItem = (si: number, ii: number) =>
    !!active && (active.kind === "item" || active.kind === "bullet") && active.si === si && active.ii === ii;

  return (
    <div
      className="doc-canvas"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(null);
      }}
    >
      <div className="doc-page">
        {/* Page-break guide (desktop only) */}
        <div aria-hidden className="doc-pagebreak" style={{ top: PAGE_H }}>
          <span>Page 2</span>
        </div>

        <div ref={contentRef} className="doc-content">
          {/* Header */}
          <div className="text-center" onFocus={() => setActive({ kind: "header" })}>
            <AutoTextarea
              className="doc-name text-center"
              value={value.header.name}
              placeholder="Your Name"
              onChange={(e) => onChange({ ...value, header: { ...value.header, name: e.target.value } })}
            />
            <AutoTextarea
              className="doc-contact text-center"
              value={value.header.contact}
              placeholder="City, ST • email • phone • github.com/you"
              onChange={(e) => onChange({ ...value, header: { ...value.header, contact: e.target.value } })}
            />
          </div>

          {value.sections.map((section, si) => (
            <section key={section.id} className="doc-section">
              <div className="relative" onFocus={() => setActive({ kind: "section", si })}>
                <input
                  className="doc-field doc-section-title"
                  value={section.title}
                  placeholder="SECTION"
                  aria-label="Section title"
                  onChange={(e) => updSection(si, { title: e.target.value })}
                />
                {active?.kind === "section" && active.si === si && (
                  <ContextBar slot={actionsSlot} label="Section">
                    <ToolBtn label="↑ Move" onClick={() => { setSections(move(value.sections, si, -1), true); setActive({ kind: "section", si: Math.max(0, si - 1) }); }} />
                    <ToolBtn label="↓ Move" onClick={() => { setSections(move(value.sections, si, 1), true); setActive({ kind: "section", si: Math.min(value.sections.length - 1, si + 1) }); }} />
                    <ToolBtn label="+ Entry" onClick={() => updSection(si, { items: [...section.items, emptyItem()] }, true)} />
                    <ToolBtn
                      label="Delete section"
                      danger
                      onClick={() => {
                        if (confirm(`Delete the "${section.title}" section?`)) {
                          setSections(value.sections.filter((_, i) => i !== si), true);
                          setActive(null);
                        }
                      }}
                    />
                  </ContextBar>
                )}
              </div>

              {section.items.map((item, ii) => {
                const inline = isInlineItem(item);
                const itemActive = isActiveItem(si, ii);
                const activeBullet = itemActive && active?.kind === "bullet" ? active.bi : -1;
                return (
                  <div
                    key={item.id}
                    className={`doc-entry relative ${inline ? "doc-inline" : ""} ${itemActive ? "is-active" : ""}`}
                    onFocus={(e) => {
                      if (!(e.target as HTMLElement).dataset.bullet) setActive({ kind: "item", si, ii });
                    }}
                  >

                    {inline ? (
                      <div className="flex items-baseline">
                        {item.subtitle ? (
                          <>
                            <AutoInput
                              className="font-bold shrink-0"
                              value={item.title}
                              placeholder="Label"
                              onChange={(v) => updItem(si, ii, { title: v })}
                            />
                            <span className="shrink-0">:&nbsp;</span>
                            <AutoTextarea
                              value={item.subtitle}
                              placeholder="Details"
                              onChange={(e) => updItem(si, ii, { subtitle: e.target.value })}
                            />
                          </>
                        ) : (
                          <AutoTextarea
                            value={item.title}
                            placeholder="Text"
                            onChange={(e) => updItem(si, ii, { title: e.target.value })}
                          />
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          <AutoInput
                            className="font-bold"
                            value={item.title}
                            placeholder="Organization / School / Project"
                            onChange={(v) => updItem(si, ii, { title: v })}
                          />
                          <AutoInput
                            className="ml-auto"
                            inputClass="text-right"
                            value={item.location}
                            placeholder="Location"
                            onChange={(v) => updItem(si, ii, { location: v })}
                          />
                        </div>
                        <div className={`flex flex-wrap items-baseline gap-x-3 ${!item.subtitle && !item.dates ? "doc-optional" : ""}`}>
                          <AutoInput
                            className="italic"
                            value={item.subtitle}
                            placeholder="Role / Degree / Tech"
                            onChange={(v) => updItem(si, ii, { subtitle: v })}
                          />
                          <AutoInput
                            className="ml-auto"
                            inputClass="text-right"
                            value={item.dates}
                            placeholder="Dates"
                            onChange={(v) => updItem(si, ii, { dates: v })}
                          />
                        </div>
                      </>
                    )}

                    {item.bullets.length > 0 && (
                      <ul className="doc-bullets">
                        {item.bullets.map((b, bi) => {
                          const fb = feedback?.[b.id];
                          const original = baseline?.get(b.id);
                          const isNew = !!baseline && original === undefined;
                          const changed = !!baseline && original !== undefined && original !== b.text;
                          const suggestion =
                            fb?.rewrite && fb.rewrite.trim() !== b.text.trim() && !rejected?.has(b.id) ? fb.rewrite : "";
                          const isActive = activeBullet === bi;
                          const tint = showHighlights && fb ? RATING[fb.rating].tint : "";
                          return (
                            <li key={b.id} className="relative">
                              {/* margin markers */}
                              {showHighlights && fb && (
                                <span
                                  aria-hidden
                                  className={`doc-ui doc-dot absolute top-[7px] h-2 w-2 rounded-full ${RATING[fb.rating].dot} ${suggestion ? "ring-2 ring-offset-1 ring-[#2f5bd3]/50" : ""}`}
                                />
                              )}
                              {showChanges && (changed || isNew) && (
                                <span aria-hidden className="doc-ui doc-changebar absolute top-[2px] bottom-[2px] w-[3px] rounded bg-[#2f5bd3]" title={isNew ? "Added" : "Changed from master"} />
                              )}
                              <div className={`flex rounded-sm ${tint}`}>
                                <span className="select-none pr-2 pl-1">•</span>
                                <AutoTextarea
                                  data-bullet={b.id}
                                  value={b.text}
                                  placeholder="Accomplishment: verb + what + measurable impact"
                                  onFocus={() => setActive({ kind: "bullet", si, ii, bi })}
                                  onChange={(e) =>
                                    setBullets(si, ii, item.bullets.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                      e.preventDefault();
                                      addBullet(si, ii, bi);
                                    } else if (e.key === "Backspace" && b.text === "") {
                                      e.preventDefault();
                                      removeBullet(si, ii, bi);
                                    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                                      e.preventDefault();
                                      focusNext.current = b.id;
                                      setBullets(si, ii, move(item.bullets, bi, e.key === "ArrowUp" ? -1 : 1), true);
                                    }
                                  }}
                                />
                              </div>

                              {/* Comment card for the focused bullet */}
                              {isActive && (fb || changed || isNew) && (
                                <div className="doc-ui doc-comment" onPointerDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
                                  {fb && (
                                    <p>
                                      <span className={`font-semibold ${RATING[fb.rating].text}`}>{RATING[fb.rating].label}.</span>{" "}
                                      {fb.note}
                                    </p>
                                  )}
                                  {suggestion && (
                                    <div className="mt-2 space-y-1.5">
                                      <p className="text-[11px] uppercase tracking-wide text-[#6b6b66]">Suggested edit</p>
                                      <p className="line-through decoration-[#c53030]/60 text-[#8a8a85]">{b.text}</p>
                                      <p className="text-[#1f6b3f] bg-[#e9f6ee] rounded px-1 -mx-1">{suggestion}</p>
                                      <div className="flex gap-1.5 pt-1">
                                        <button
                                          type="button"
                                          onPointerDown={(e) => e.preventDefault()}
                                          className="rounded-md bg-[#2f5bd3] px-2.5 py-1 text-xs font-medium text-white"
                                          onClick={() =>
                                            setBullets(si, ii, item.bullets.map((x) => (x.id === b.id ? { ...x, text: suggestion } : x)), true)
                                          }
                                        >
                                          ✓ Accept
                                        </button>
                                        {onReject && (
                                          <button
                                            type="button"
                                            onPointerDown={(e) => e.preventDefault()}
                                            className="rounded-md border border-[#e2e2de] px-2.5 py-1 text-xs"
                                            onClick={() => onReject(b.id)}
                                          >
                                            ✕ Reject
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  {showChanges && changed && (
                                    <div className="mt-2 border-t border-[#efefeb] pt-2">
                                      <p className="text-[11px] uppercase tracking-wide text-[#6b6b66]">Master version</p>
                                      <p className="text-[#6b6b66]">{original}</p>
                                      <button
                                        type="button"
                                        onPointerDown={(e) => e.preventDefault()}
                                        className="mt-1 text-xs text-[#2f5bd3] underline underline-offset-2"
                                        onClick={() =>
                                          setBullets(si, ii, item.bullets.map((x) => (x.id === b.id ? { ...x, text: original! } : x)), true)
                                        }
                                      >
                                        Revert to master
                                      </button>
                                    </div>
                                  )}
                                  {showChanges && isNew && !fb && (
                                    <p className="text-[#6b6b66]">Added in this version (not in your master).</p>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {itemActive && (
                      <ContextBar slot={actionsSlot} label={activeBullet >= 0 ? "Bullet" : "Entry"}>
                        {activeBullet >= 0 ? (
                          <>
                            <ToolBtn label="↑" onClick={() => { setBullets(si, ii, move(item.bullets, activeBullet, -1), true); focusNext.current = item.bullets[activeBullet].id; }} />
                            <ToolBtn label="↓" onClick={() => { setBullets(si, ii, move(item.bullets, activeBullet, 1), true); focusNext.current = item.bullets[activeBullet].id; }} />
                            <ToolBtn label="Delete bullet" danger onClick={() => removeBullet(si, ii, activeBullet)} />
                            <span className="mx-1 h-4 w-px bg-[#e2e2de]" />
                          </>
                        ) : null}
                        <ToolBtn label="+ Bullet" onClick={() => addBullet(si, ii, activeBullet >= 0 ? activeBullet : item.bullets.length - 1)} />
                        <ToolBtn label="Entry ↑" onClick={() => { updSection(si, { items: move(section.items, ii, -1) }, true); setActive(null); }} />
                        <ToolBtn label="Entry ↓" onClick={() => { updSection(si, { items: move(section.items, ii, 1) }, true); setActive(null); }} />
                        <ToolBtn
                          label="Delete entry"
                          danger
                          onClick={() => {
                            updSection(si, { items: section.items.filter((_, i) => i !== ii) }, true);
                            setActive(null);
                          }}
                        />
                      </ContextBar>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
