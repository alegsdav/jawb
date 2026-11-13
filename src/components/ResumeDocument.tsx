"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Analysis, Bullet, Item, Resume, Section } from "@/lib/types";
import { emptyItem, isInlineItem, uid } from "@/lib/resume";
import { hasMock } from "@/lib/bank";

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
  /** Called when the user accepts a suggested rewrite (so it can be saved to the bullet bank). */
  onAccept?: (text: string, entryTitle: string) => void;
};

/** What's selected, by id (indexes would go stale after a drag). */
type Active =
  | { kind: "section"; sid: string }
  | { kind: "item"; sid: string; iid: string }
  | { kind: "bullet"; sid: string; iid: string; bid: string }
  | null;

// Letter page at 96dpi with 0.6in margins; matches the PDF export.
const PAGE_H = 1056;
const MARGIN = 58;
const LINE = 18;

// ---------- drag & drop ----------

/** Start a drag from blank space or a grip, never from text you're typing in. */
function canStartDrag(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  if (el.closest("[data-drag-handle]")) return true;
  return !el.closest("input, textarea, button, select, a, [data-no-drag]");
}

class DocMouseSensor extends MouseSensor {
  static activators = [
    { eventName: "onMouseDown" as const, handler: ({ nativeEvent }: { nativeEvent: MouseEvent }) => nativeEvent.button === 0 && canStartDrag(nativeEvent.target) },
  ];
}

class DocTouchSensor extends TouchSensor {
  static activators = [
    { eventName: "onTouchStart" as const, handler: ({ nativeEvent }: { nativeEvent: TouchEvent }) => canStartDrag(nativeEvent.target) },
  ];
}

// Ids are "sec:<id>", "item:<id>", "bul:<id>"; each list only sorts among its siblings.
const kindOf = (id: string | number) => String(id).split(":")[0];
const rawId = (id: string | number) => String(id).slice(String(id).indexOf(":") + 1);

const siblingsOnly: CollisionDetection = (args) => {
  const kind = kindOf(args.active.id);
  const parent = args.active.data.current?.parent;
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (c) => kindOf(c.id) === kind && c.data.current?.parent === parent,
    ),
  });
};

type SortableBits = ReturnType<typeof useSortable>;

function sortableStyle(s: SortableBits): React.CSSProperties {
  const t = s.transform;
  return {
    transform: t ? `translate3d(0, ${Math.round(t.y)}px, 0)` : undefined,
    transition: s.transition,
  };
}

function Sortable({
  id, parent, children,
}: {
  id: string;
  parent: string;
  children: (s: SortableBits) => React.ReactNode;
}) {
  const s = useSortable({ id, data: { parent } });
  return <>{children(s)}</>;
}

// ---------- small building blocks ----------

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return arr;
  return arrayMove(arr, i, j);
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
      // Desktop: keep the caret where it is. (Mobile Safari never focuses buttons; selection survives because
      // it's only cleared by taps outside the document, not by blur.)
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-md text-xs whitespace-nowrap hover:bg-black/5 active:bg-black/10 ${danger ? "text-[#c53030]" : "text-[#3c3c3a]"}`}
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
      data-no-drag
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

/** Six-dot grip in the left margin (desktop). Blank space in the block is draggable too. */
function Grip({ s, title }: { s: SortableBits; title: string }) {
  return (
    <span
      data-drag-handle
      title={title}
      aria-label={title}
      className="doc-ui doc-grip"
      {...s.listeners}
    >
      ⋮⋮
    </span>
  );
}

const RATING: Record<Feedback["rating"], { label: string; tint: string; dot: string; text: string }> = {
  strong: { label: "Strong", tint: "bg-[#e9f6ee]", dot: "bg-[#1f8a4c]", text: "text-[#1f8a4c]" },
  ok: { label: "Okay", tint: "bg-[#fdf5e2]", dot: "bg-[#c98a12]", text: "text-[#a86f05]" },
  weak: { label: "Weak", tint: "bg-[#fdecec]", dot: "bg-[#c53030]", text: "text-[#c53030]" },
};

const isField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, button, select, a");

// ---------- the document ----------

export function ResumeDocument({
  value, onChange, feedback, showHighlights = true, baseline, showChanges = true, rejected, onReject, onMeasure, actionsSlot,
  onAccept,
}: Props) {
  const [active, setActive] = useState<Active>(null);
  const focusNext = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(DocMouseSensor, { activationConstraint: { distance: 5 } }),
    // Phones: press and hold ~¼s on blank space, a grip or a bullet dot, then drag.
    useSensor(DocTouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  // Clear the selection only when the user taps/clicks or tabs outside the document and its toolbar.
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
    // Selecting a whole block (not typing): drop the caret so the box selection is obvious.
    const el = document.activeElement as HTMLElement | null;
    if (el && canvasRef.current?.contains(el)) el.blur();
    setActive(next);
  }

  function onDragEnd({ active: a, over }: DragEndEvent) {
    if (!over || a.id === over.id) return;
    const kind = kindOf(a.id);
    const from = rawId(a.id);
    const to = rawId(over.id);
    if (kind === "sec") {
      const i = value.sections.findIndex((s) => s.id === from);
      const j = value.sections.findIndex((s) => s.id === to);
      setSections(arrayMove(value.sections, i, j), true);
      setActive({ kind: "section", sid: from });
    } else if (kind === "item") {
      const sid = String(a.data.current?.parent).slice(4);
      updSection(sid, (s) => {
        const i = s.items.findIndex((it) => it.id === from);
        const j = s.items.findIndex((it) => it.id === to);
        return { ...s, items: arrayMove(s.items, i, j) };
      }, true);
      setActive({ kind: "item", sid, iid: from });
    } else if (kind === "bul") {
      const [sid, iid] = String(a.data.current?.parent).slice(5).split("/");
      const item = value.sections.find((s) => s.id === sid)?.items.find((it) => it.id === iid);
      if (!item) return;
      const i = item.bullets.findIndex((b) => b.id === from);
      const j = item.bullets.findIndex((b) => b.id === to);
      setBullets(sid, iid, arrayMove(item.bullets, i, j), true);
    }
  }

  return (
    <div ref={canvasRef} className="doc-canvas">
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
              onChange={(e) => onChange({ ...value, header: { ...value.header, name: e.target.value } })}
            />
            <AutoTextarea
              className="doc-contact text-center"
              value={value.header.contact}
              placeholder="City, ST • email • phone • github.com/you"
              onChange={(e) => onChange({ ...value, header: { ...value.header, contact: e.target.value } })}
            />
          </div>

          <DndContext id="resume-doc" sensors={sensors} collisionDetection={siblingsOnly} onDragEnd={onDragEnd}>
            <SortableContext items={value.sections.map((s) => `sec:${s.id}`)} strategy={verticalListSortingStrategy}>
              {value.sections.map((section, si) => (
                <Sortable key={section.id} id={`sec:${section.id}`} parent="root">
                  {(ss) => {
                    const sectionActive = active?.kind === "section" && active.sid === section.id;
                    return (
                      <section
                        ref={ss.setNodeRef}
                        style={sortableStyle(ss)}
                        {...ss.listeners}
                        className={`doc-section doc-block ${sectionActive ? "is-selected" : ""} ${ss.isDragging ? "is-dragging" : ""}`}
                        onClick={(e) => {
                          if (!isField(e.target)) selectBlock({ kind: "section", sid: section.id });
                        }}
                      >
                        <Grip s={ss} title="Drag section" />
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

                        <SortableContext items={section.items.map((it) => `item:${it.id}`)} strategy={verticalListSortingStrategy}>
                          {section.items.map((item, ii) => (
                            <Sortable key={item.id} id={`item:${item.id}`} parent={`sec:${section.id}`}>
                              {(is) =>
                                renderEntry(section, item, ii, is)
                              }
                            </Sortable>
                          ))}
                        </SortableContext>
                      </section>
                    );
                  }}
                </Sortable>
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  );

  function renderEntry(section: Section, item: Item, ii: number, is: SortableBits) {
    const sid = section.id;
    const inline = isInlineItem(item);
    const itemActive = !!active && active.kind !== "section" && active.sid === sid && active.iid === item.id;
    const activeBid = itemActive && active?.kind === "bullet" ? active.bid : null;
    const activeBi = activeBid ? item.bullets.findIndex((b) => b.id === activeBid) : -1;

    return (
      <div
        ref={is.setNodeRef}
        style={sortableStyle(is)}
        {...is.listeners}
        className={`doc-entry doc-block relative ${inline ? "doc-inline" : ""} ${itemActive ? "is-active" : ""} ${
          itemActive && !activeBid && active?.kind === "item" ? "is-selected" : ""
        } ${is.isDragging ? "is-dragging" : ""}`}
        onClick={(e) => {
          e.stopPropagation(); // don't also select the section
          if (!isField(e.target)) selectBlock({ kind: "item", sid, iid: item.id });
        }}
        onFocus={(e) => {
          e.stopPropagation();
          if (!(e.target as HTMLElement).dataset.bullet) setActive({ kind: "item", sid, iid: item.id });
        }}
      >
        <Grip s={is} title="Drag entry" />

        {inline ? (
          <div className="flex items-baseline">
            {item.subtitle ? (
              <>
                <AutoInput className="font-bold shrink-0" value={item.title} placeholder="Label" onChange={(v) => updItem(sid, item.id, { title: v })} />
                <span className="shrink-0">:&nbsp;</span>
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
          <SortableContext items={item.bullets.map((b) => `bul:${b.id}`)} strategy={verticalListSortingStrategy}>
            <ul className="doc-bullets">
              {item.bullets.map((b, bi) => (
                <Sortable key={b.id} id={`bul:${b.id}`} parent={`item:${sid}/${item.id}`}>
                  {(bs) => renderBullet(sid, item, b, bi, bs, activeBid === b.id)}
                </Sortable>
              ))}
            </ul>
          </SortableContext>
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
                updSection(sid, (s) => ({ ...s, items: s.items.filter((it) => it.id !== item.id) }), true);
                setActive(null);
              }}
            />
          </ContextBar>
        )}
      </div>
    );
  }

  function renderBullet(sid: string, item: Item, b: Bullet, bi: number, bs: SortableBits, isActive: boolean) {
    const fb = feedback?.[b.id];
    const original = baseline?.get(b.id);
    const isNew = !!baseline && original === undefined;
    const changed = !!baseline && original !== undefined && original !== b.text;
    const suggestion = fb?.rewrite && fb.rewrite.trim() !== b.text.trim() && !rejected?.has(b.id) ? fb.rewrite : "";
    const mock = hasMock(b.text);
    const tint = showHighlights && fb ? RATING[fb.rating].tint : mock ? "bg-[#fff6d6]" : "";
    const replace = (text: string) => setBullets(sid, item.id, item.bullets.map((x) => (x.id === b.id ? { ...x, text } : x)), true);

    return (
      <li ref={bs.setNodeRef} style={sortableStyle(bs)} className={`relative ${bs.isDragging ? "is-dragging" : ""}`}>
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
          {/* The bullet dot is the drag handle for the bullet. */}
          <span
            data-drag-handle
            {...bs.attributes}
            {...bs.listeners}
            aria-label="Drag bullet"
            className="doc-bullet-dot select-none pr-2 pl-1"
          >
            •
          </span>
          <AutoTextarea
            data-bullet={b.id}
            value={b.text}
            placeholder="Accomplishment: verb + what + measurable impact"
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
        {isActive && (fb || changed || isNew || mock) && (
          <div data-no-drag className="doc-ui doc-comment">
            {mock && (
              <p className="mb-2 rounded bg-[#fff6d6] px-2 py-1 text-[#5c4300]">
                Contains example values in [brackets]. Replace them with your real numbers (or remove them) before sending.
              </p>
            )}
            {fb && (
              <p>
                <span className={`font-semibold ${RATING[fb.rating].text}`}>{RATING[fb.rating].label}.</span> {fb.note}
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
                    onMouseDown={(e) => e.preventDefault()}
                    className="rounded-md bg-[#2f5bd3] px-3 py-1.5 text-xs font-medium text-white"
                    onClick={() => {
                      replace(suggestion);
                      onAccept?.(suggestion, item.title);
                    }}
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
                <p className="text-[11px] uppercase tracking-wide text-[#6b6b66]">Master version</p>
                <p className="text-[#6b6b66]">{original}</p>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="mt-1 text-xs text-[#2f5bd3] underline underline-offset-2"
                  onClick={() => replace(original!)}
                >
                  Revert to master
                </button>
              </div>
            )}
            {showChanges && isNew && !fb && <p className="text-[#6b6b66]">Added in this version (not in your master).</p>}
          </div>
        )}
      </li>
    );
  }
}
