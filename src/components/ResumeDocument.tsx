"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Bullet, Item, Resume, Section } from "@/lib/types";
import { emptyItem, isInlineItem, uid } from "@/lib/resume";
import { PLACEHOLDER_RE } from "@/lib/facts";
import type { BulletFeedback, Rating } from "@/lib/analysis";
import { markPlaceholders } from "./PlaceholderTextarea";

type Props = {
  value: Resume;
  /** commit=true for structural edits so they become their own undo step. */
  onChange: (r: Resume, commit?: boolean) => void;
  /** AI feedback per bullet id, already checked against the current text (see bulletFeedback). */
  feedback?: Record<string, BulletFeedback>;
  showHighlights?: boolean;
  /** Bullet texts the copy is compared against ("changed from master"): the copy's baseline or the master. */
  baseline?: Map<string, string> | null;
  showChanges?: boolean;
  /** Reject a bullet's pending suggestion. */
  onReject?: (bulletId: string) => void;
  /** Reports page count and roughly how many lines spill past page 1. */
  onMeasure?: (m: { pages: number; overflowLines: number }) => void;
  /** Element in the page toolbar where contextual actions (move/delete) render. */
  actionsSlot?: HTMLElement | null;
  /**
   * Select a bullet, scroll it into view and open its comment card. Pass a new object (e.g. with an
   * incrementing `n`) each time. Works on iOS too, where focusing a field outside a tap is ignored.
   */
  reveal?: { id: string; n: number } | null;
};

/** What's selected, by id (indexes go stale after a move). */
type Active =
  | { kind: "section"; sid: string }
  | { kind: "item"; sid: string; iid: string }
  | { kind: "bullet"; sid: string; iid: string; bid: string }
  | null;

// Letter page at 96dpi with 0.6in margins; matches the PDF export.
const PAGE_H = 1056;
const MARGIN = 58;
const LINE = 18;

// ---------- small building blocks ----------

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return arr;
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

/**
 * Textarea that grows with its content. With `highlight`, a mirror of the text sits in the same grid
 * cell behind it and paints a highlight under every [placeholder]. The structure is the same whether
 * or not there are placeholders, so typing a "]" never remounts the field (and drops the keyboard).
 */
function AutoTextarea({ highlight, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { highlight?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  });
  const cls = `doc-field block w-full ${props.className ?? ""}`;
  const field = (
    <textarea ref={ref} rows={1} {...props} className={`${cls} resize-none overflow-hidden ${highlight ? "relative col-start-1 row-start-1" : ""}`} />
  );
  if (!highlight) return field;
  return (
    <div className="grid w-full min-w-0">
      <div aria-hidden className={`doc-mirror col-start-1 row-start-1 ${cls}`}>
        {markPlaceholders(String(props.value ?? ""))}
        {"​"}
      </div>
      {field}
    </div>
  );
}

function ToolBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      // Desktop: keep the caret where it is. (Mobile Safari never focuses buttons; selection survives because
      // it's only cleared by taps outside the document, not by blur.)
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-h-10 sm:min-h-0 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-md text-xs whitespace-nowrap hover:bg-black/5 active:bg-black/10 ${danger ? "text-[#c53030]" : "text-[#3c3c3a]"}`}
    >
      {label}
    </button>
  );
}

/**
 * Contextual move/delete actions for the selected section/entry/bullet.
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

const RATING: Record<Rating, { label: string; tint: string; dot: string; text: string }> = {
  strong: { label: "Strong", tint: "bg-[#e9f6ee]", dot: "bg-[#1f8a4c]", text: "text-[#1f8a4c]" },
  ok: { label: "Okay", tint: "bg-[#fdf5e2]", dot: "bg-[#c98a12]", text: "text-[#a86f05]" },
  weak: { label: "Weak", tint: "bg-[#fdecec]", dot: "bg-[#c53030]", text: "text-[#c53030]" },
};

const isField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, button, select, a");

function locateBullet(r: Resume, bid: string): { sid: string; iid: string } | null {
  for (const s of r.sections) for (const it of s.items) if (it.bullets.some((b) => b.id === bid)) return { sid: s.id, iid: it.id };
  return null;
}

// ---------- the document ----------

export function ResumeDocument({
  value, onChange, feedback, showHighlights = true, baseline, showChanges = true, onReject, onMeasure, actionsSlot,
  reveal,
}: Props) {
  const [active, setActive] = useState<Active>(null);
  const focusNext = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Whether the current press began on an input/button (see selectBlock). */
  const downOnField = useRef(false);

  // A reveal request selects its bullet right away (during render, so the comment card shows on the same paint).
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== revealed) {
    setRevealed(reveal);
    const loc = reveal ? locateBullet(value, reveal.id) : null;
    if (reveal && loc) setActive({ kind: "bullet", ...loc, bid: reveal.id });
  }
  useEffect(() => {
    if (!reveal) return;
    const el = document.querySelector<HTMLTextAreaElement>(`[data-bullet="${reveal.id}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    // Desktop gets the caret too. iOS ignores this outside a tap; the selection above still shows the card.
    el?.focus({ preventScroll: true });
  }, [reveal]);

  // Clear the selection only when the user taps/clicks or tabs outside the document and its toolbar slot.
  // (Not on blur: iOS Safari never focuses buttons, so blur/relatedTarget can't tell a toolbar tap from leaving.)
  useEffect(() => {
    const outside = (t: EventTarget | null) => {
      const n = t as Node | null;
      return !!n && !canvasRef.current?.contains(n) && !actionsSlot?.contains(n);
    };
    const onDown = (e: PointerEvent) => outside(e.target) && setActive(null);
    const onFocus = (e: FocusEvent) => outside(e.target) && setActive(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [actionsSlot]);

  // Focus a bullet created/removed/moved by keyboard once it's rendered.
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

  // ---- immutable update helpers (by id) ----
  const setSections = (sections: Section[], commit = false) => onChange({ ...value, sections }, commit);
  const updSection = (sid: string, fn: (s: Section) => Section, commit = false) =>
    setSections(value.sections.map((s) => (s.id === sid ? fn(s) : s)), commit);
  const updItem = (sid: string, iid: string, patch: Partial<Item>, commit = false) =>
    updSection(sid, (s) => ({ ...s, items: s.items.map((it) => (it.id === iid ? { ...it, ...patch } : it)) }), commit);
  const setBullets = (sid: string, iid: string, bullets: Bullet[], commit = false) => updItem(sid, iid, { bullets }, commit);

  function addBullet(sid: string, item: Item, afterIndex: number) {
    const b = { id: uid(), text: "" };
    const next = [...item.bullets];
    next.splice(afterIndex + 1, 0, b);
    focusNext.current = b.id;
    setBullets(sid, item.id, next, true);
    setActive({ kind: "bullet", sid, iid: item.id, bid: b.id });
  }

  function removeBullet(sid: string, item: Item, bid: string) {
    const bi = item.bullets.findIndex((b) => b.id === bid);
    const prev = item.bullets[bi - 1];
    if (prev) focusNext.current = prev.id;
    setBullets(sid, item.id, item.bullets.filter((b) => b.id !== bid), true);
    setActive(prev ? { kind: "bullet", sid, iid: item.id, bid: prev.id } : { kind: "item", sid, iid: item.id });
  }

  function selectBlock(next: Active) {
    // A press that started in a field is typing, even if layout shifted and the click landed on the block.
    if (downOnField.current) return;
    // Selecting a whole block (not typing): drop the caret so the box selection is obvious.
    const el = document.activeElement as HTMLElement | null;
    if (el && canvasRef.current?.contains(el)) el.blur();
    setActive(next);
  }

  return (
    <div ref={canvasRef} className="doc-canvas" onPointerDownCapture={(e) => (downOnField.current = isField(e.target))}>
      <div className="doc-page">
        {/* Page-break guide (desktop only) */}
        <div aria-hidden className="doc-pagebreak" style={{ top: PAGE_H }}>
          <span>Page 2</span>
        </div>

        <div ref={contentRef} className="doc-content">
          {/* Header */}
          <div className="text-center" onFocus={() => setActive(null)}>
            <AutoTextarea
              className="doc-name text-center"
              value={value.header.name}
              placeholder="Your Name"
              aria-label="Name"
              onChange={(e) => onChange({ ...value, header: { ...value.header, name: e.target.value } })}
            />
            <AutoTextarea
              className="doc-contact text-center"
              value={value.header.contact}
              placeholder="City, ST • email • phone • github.com/you"
              aria-label="Contact line"
              onChange={(e) => onChange({ ...value, header: { ...value.header, contact: e.target.value } })}
            />
          </div>

          {value.sections.map((section, si) => {
            const sectionActive = active?.kind === "section" && active.sid === section.id;
            return (
              <section
                key={section.id}
                className={`doc-section doc-block ${sectionActive ? "is-selected" : ""}`}
                onClick={(e) => {
                  if (!isField(e.target)) selectBlock({ kind: "section", sid: section.id });
                }}
              >
                <div className="relative" onFocus={() => setActive({ kind: "section", sid: section.id })}>
                  <input
                    className="doc-field doc-section-title"
                    value={section.title}
                    placeholder="SECTION"
                    aria-label="Section title"
                    onChange={(e) => updSection(section.id, (s) => ({ ...s, title: e.target.value }))}
                  />
                  {sectionActive && (
                    <ContextBar slot={actionsSlot} label="Section">
                      <ToolBtn label="↑ Move" onClick={() => setSections(move(value.sections, si, -1), true)} />
                      <ToolBtn label="↓ Move" onClick={() => setSections(move(value.sections, si, 1), true)} />
                      <ToolBtn label="+ Entry" onClick={() => updSection(section.id, (s) => ({ ...s, items: [...s.items, emptyItem()] }), true)} />
                      <ToolBtn
                        label="Delete section"
                        danger
                        onClick={() => {
                          if (confirm(`Delete the "${section.title}" section?`)) {
                            setSections(value.sections.filter((s) => s.id !== section.id), true);
                            setActive(null);
                          }
                        }}
                      />
                    </ContextBar>
                  )}
                </div>

                {section.items.map((item, ii) => renderEntry(section, item, ii))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );

  function renderEntry(section: Section, item: Item, ii: number) {
    const sid = section.id;
    const inline = isInlineItem(item);
    const itemActive = !!active && active.kind !== "section" && active.sid === sid && active.iid === item.id;
    const activeBid = itemActive && active?.kind === "bullet" ? active.bid : null;
    const activeBi = activeBid ? item.bullets.findIndex((b) => b.id === activeBid) : -1;

    return (
      <div
        key={item.id}
        className={`doc-entry doc-block relative ${inline ? "doc-inline" : ""} ${itemActive ? "is-active" : ""} ${
          itemActive && !activeBid && active?.kind === "item" ? "is-selected" : ""
        }`}
        onClick={(e) => {
          e.stopPropagation(); // don't also select the section
          if (!isField(e.target)) selectBlock({ kind: "item", sid, iid: item.id });
        }}
        onFocus={(e) => {
          e.stopPropagation();
          if (!(e.target as HTMLElement).dataset.bullet) setActive({ kind: "item", sid, iid: item.id });
        }}
      >
        {inline ? (
          <div className="flex items-baseline">
            {item.subtitle ? (
              <>
                <AutoInput className="font-bold shrink-0" value={item.title} placeholder="Label" onChange={(v) => updItem(sid, item.id, { title: v })} />
                {/* The label's sizing box is 4px wider than its text (field padding); pull the colon back against it. */}
                <span className="shrink-0 -ml-[4px] relative">:&nbsp;</span>
                <AutoTextarea value={item.subtitle} placeholder="Details" onChange={(e) => updItem(sid, item.id, { subtitle: e.target.value })} />
              </>
            ) : (
              <AutoTextarea value={item.title} placeholder="Text" onChange={(e) => updItem(sid, item.id, { title: e.target.value })} />
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <AutoInput className="font-bold" value={item.title} placeholder="Organization / School / Project" onChange={(v) => updItem(sid, item.id, { title: v })} />
              <AutoInput className="ml-auto" inputClass="text-right" value={item.location} placeholder="Location" onChange={(v) => updItem(sid, item.id, { location: v })} />
            </div>
            <div className={`flex flex-wrap items-baseline gap-x-3 ${!item.subtitle && !item.dates ? "doc-optional" : ""}`}>
              <AutoInput className="italic" value={item.subtitle} placeholder="Role / Degree / Tech" onChange={(v) => updItem(sid, item.id, { subtitle: v })} />
              <AutoInput className="ml-auto" inputClass="text-right" value={item.dates} placeholder="Dates" onChange={(v) => updItem(sid, item.id, { dates: v })} />
            </div>
          </>
        )}

        {item.bullets.length > 0 && (
          <ul className="doc-bullets">{item.bullets.map((b, bi) => renderBullet(sid, item, b, bi, activeBid === b.id))}</ul>
        )}

        {itemActive && (
          <ContextBar slot={actionsSlot} label={activeBid ? "Bullet" : "Entry"}>
            {activeBid ? (
              <>
                <ToolBtn label="↑" onClick={() => { setBullets(sid, item.id, move(item.bullets, activeBi, -1), true); focusNext.current = activeBid; }} />
                <ToolBtn label="↓" onClick={() => { setBullets(sid, item.id, move(item.bullets, activeBi, 1), true); focusNext.current = activeBid; }} />
                <ToolBtn label="Delete bullet" danger onClick={() => removeBullet(sid, item, activeBid)} />
                <span className="mx-1 h-4 w-px bg-[#e2e2de]" />
              </>
            ) : null}
            <ToolBtn label="+ Bullet" onClick={() => addBullet(sid, item, activeBi >= 0 ? activeBi : item.bullets.length - 1)} />
            <ToolBtn label="Entry ↑" onClick={() => updSection(sid, (s) => ({ ...s, items: move(s.items, ii, -1) }), true)} />
            <ToolBtn label="Entry ↓" onClick={() => updSection(sid, (s) => ({ ...s, items: move(s.items, ii, 1) }), true)} />
            <ToolBtn
              label="Delete entry"
              danger
              onClick={() => {
                const name = [item.title, item.subtitle].map((x) => x.trim()).filter(Boolean).join(" — ");
                if (!confirm(name ? `Delete the "${name}" entry?` : "Delete this entry?")) return;
                updSection(sid, (s) => ({ ...s, items: s.items.filter((it) => it.id !== item.id) }), true);
                setActive(null);
              }}
            />
          </ContextBar>
        )}
      </div>
    );
  }

  function renderBullet(sid: string, item: Item, b: Bullet, bi: number, isActive: boolean) {
    const view = feedback?.[b.id];
    const fb = view?.state === "current" ? view : null; // rating/note only while the bullet reads as rated
    const original = baseline?.get(b.id);
    const isNew = !!baseline && original === undefined;
    const changed = !!baseline && original !== undefined && original !== b.text;
    const suggestion = fb?.suggestion ?? "";
    const placeholders = [...b.text.matchAll(PLACEHOLDER_RE)].map((m) => ({ text: m[0], start: m.index! }));
    const placeholder = placeholders.length > 0;
    // Placeholders win over the rating tint: they must be impossible to miss before applying.
    const tint = placeholder ? "bg-[#fff6d6]" : showHighlights && fb ? RATING[fb.rating].tint : "";
    const replace = (text: string) => setBullets(sid, item.id, item.bullets.map((x) => (x.id === b.id ? { ...x, text } : x)), true);
    const selectPlaceholder = (p: { text: string; start: number }) => {
      const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-bullet="${b.id}"]`);
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(p.start, p.start + p.text.length);
    };

    return (
      <li key={b.id} className="relative">
        {showHighlights && view && view.state !== "stale" && (
          <span
            aria-hidden
            title={fb ? RATING[fb.rating].label : "Updated"}
            className={`doc-ui doc-dot absolute top-[7px] h-2 w-2 rounded-full ${fb ? RATING[fb.rating].dot : "bg-[#9a9a95]"} ${
              suggestion ? "ring-2 ring-offset-1 ring-[#2f5bd3]/50" : ""
            }`}
          />
        )}
        {showChanges && (changed || isNew) && (
          <span
            aria-hidden
            className="doc-ui doc-changebar absolute top-[2px] bottom-[2px] w-[3px] rounded bg-[#2f5bd3]"
            title={isNew ? "Added in this tailored copy" : "Changed from master resume"}
          />
        )}
        <div className={`flex rounded-sm ${tint}`}>
          <span aria-hidden className="select-none pr-2 pl-1">•</span>
          <AutoTextarea
            highlight
            data-bullet={b.id}
            value={b.text}
            placeholder="Accomplishment: verb + what + measurable impact"
            aria-label="Bullet"
            onFocus={(e) => {
              e.stopPropagation();
              setActive({ kind: "bullet", sid, iid: item.id, bid: b.id });
            }}
            onChange={(e) => setBullets(sid, item.id, item.bullets.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addBullet(sid, item, bi);
              } else if (e.key === "Backspace" && b.text === "") {
                e.preventDefault();
                removeBullet(sid, item, b.id);
              } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                e.preventDefault();
                focusNext.current = b.id;
                setBullets(sid, item.id, move(item.bullets, bi, e.key === "ArrowUp" ? -1 : 1), true);
              }
            }}
          />
        </div>

        {/* Comment card for the selected bullet */}
        {isActive && (view || changed || isNew || placeholder) && (
          <div className="doc-ui doc-comment">
            {placeholder && (
              <div className="mb-2 rounded bg-[#fff6d6] px-2 py-1.5 text-[#5c4300]">
                <p>Replace each [placeholder] with your real number, or reword the bullet, before you apply.</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {placeholders.map((p) => (
                    <button
                      key={p.start}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectPlaceholder(p)}
                      className="min-h-8 rounded border border-[#d9a800] bg-[#ffd84d] px-2 text-xs font-medium text-[#3d2c00]"
                      title="Select it so you can type over it"
                    >
                      {p.text}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {fb && (
              <p>
                <span className={`font-semibold ${RATING[fb.rating].text}`}>{RATING[fb.rating].label}.</span> {fb.note}
              </p>
            )}
            {view?.state === "updated" && (
              <p>
                <span className="font-semibold">Updated.</span>{" "}
                <span className="text-[#6b6b66]">You accepted the suggested edit. Re-analyze to rate the new wording.</span>
              </p>
            )}
            {view?.state === "stale" && (
              <p className="text-[#6b6b66]">Edited since the last analysis, so its rating is hidden. Re-analyze for feedback on this wording.</p>
            )}
            {suggestion && (
              <div className="mt-2 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-[#6b6b66]">Suggested edit</p>
                <p className="line-through decoration-[#c53030]/60 text-[#8a8a85]">{b.text}</p>
                <p className="text-[#1f6b3f] bg-[#e9f6ee] rounded px-1 -mx-1">{suggestion}</p>
                <div className="flex gap-1.5 pt-1">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    className="rounded-md bg-[#2f5bd3] px-3 py-1.5 text-xs font-medium text-white"
                    onClick={() => replace(suggestion)}
                  >
                    ✓ Accept
                  </button>
                  {onReject && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      className="rounded-md border border-[#e2e2de] px-3 py-1.5 text-xs"
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
                <p className="text-[11px] uppercase tracking-wide text-[#6b6b66]">Master resume version</p>
                <p className="text-[#6b6b66]">{original}</p>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="mt-1 min-h-8 text-xs text-[#2f5bd3] underline underline-offset-2"
                  onClick={() => replace(original!)}
                >
                  Revert to master resume
                </button>
              </div>
            )}
            {showChanges && isNew && !view && (
              <p className="text-[#6b6b66]">Added in this tailored copy (not in your master resume).</p>
            )}
          </div>
        )}
      </li>
    );
  }
}

// ---------- read-only view ----------

/** The same Harvard page, not editable (e.g. the frozen copy that was submitted). */
export function ResumeView({ value }: { value: Resume }) {
  return (
    <div className="doc-canvas">
      <div className="doc-page doc-readonly">
        <div className="doc-content">
          <div className="text-center">
            {value.header.name && <div className="doc-name">{value.header.name}</div>}
            {value.header.contact && <div className="doc-contact">{value.header.contact}</div>}
          </div>
          {value.sections.map((section) => (
            <section key={section.id} className="doc-section">
              <h3 className="doc-section-title">{section.title}</h3>
              {section.items.map((it) =>
                isInlineItem(it) ? (
                  <div key={it.id} className="doc-entry">
                    {it.subtitle ? (
                      <>
                        <span className="font-bold">{it.title}:</span> {it.subtitle}
                      </>
                    ) : (
                      it.title
                    )}
                  </div>
                ) : (
                  <div key={it.id} className="doc-entry">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-bold">{it.title}</span>
                      <span className="ml-auto">{it.location}</span>
                    </div>
                    {(it.subtitle || it.dates) && (
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className="italic">{it.subtitle}</span>
                        <span className="ml-auto">{it.dates}</span>
                      </div>
                    )}
                    {it.bullets.some((b) => b.text.trim()) && (
                      <ul className="doc-bullets">
                        {it.bullets
                          .filter((b) => b.text.trim())
                          .map((b) => (
                            <li key={b.id} className="flex">
                              <span aria-hidden className="select-none pr-2 pl-1">•</span>
                              <span className="min-w-0 flex-1">{b.text}</span>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                ),
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
