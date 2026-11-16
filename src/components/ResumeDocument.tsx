"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorState, Plugin, TextSelection, type Command, type Transaction } from "prosemirror-state";
import type { DecorationSet } from "prosemirror-view";
import { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { BulletFeedback } from "@/lib/analysis";
import type { Resume, TextStyle } from "@/lib/types";
import { effectiveStyle } from "@/lib/textStyle";
import { isInlineItem } from "@/lib/resume";
import type { LineKind, LinePart } from "@/lib/docLineTypes";
import { linesToResume, lineEffectiveStyle, resumeToLines } from "@/lib/docLines";
import { docToLines, linesToDoc, nodeToLine } from "@/lib/pmSchema";
import {
  caretInfo,
  editorKeymap,
  headerGuard,
  pasteTextParser,
  replaceLineTextCommand,
  resetStyleCommand,
  setLineKindCommand,
  stripPastedIds,
  toggleStyleCommand,
} from "@/lib/docEditing";
import { buildDecorations, bulletInfo, type DecorationOptions } from "./docDecorations";
import { BulletCommentCard } from "./BulletCommentCard";
import { LINE_KIND_LABELS, type DocCommands, type DocSelection, type FormatState } from "./editorTypes";
import { ListIcon } from "./icons";

export type { DocCommands, DocSelection, FormatState } from "./editorTypes";

type Props = {
  value: Resume;
  /** commit=true for structural edits (paragraph style, line count) so they become their own undo step. */
  onChange: (r: Resume, commit?: boolean) => void;
  /** AI feedback per bullet id, already checked against the current text (see bulletFeedback). */
  feedback?: Record<string, BulletFeedback>;
  /** Draw the AI's rating tints and dots over the text. Default true. */
  showHighlights?: boolean;
  /** Bullet texts the copy is compared against ("changed from master"): the copy's baseline or the master. */
  baseline?: Map<string, string> | null;
  /** Draw the change bar next to bullets that differ from the baseline. Default true. */
  showChanges?: boolean;
  /** Reject a bullet's pending suggestion. */
  onReject?: (bulletId: string) => void;
  /** Reports page count and roughly how many lines spill past page 1. */
  onMeasure?: (m: { pages: number; overflowLines: number }) => void;
  /** Element in the page toolbar where the formatting controls render. With no slot, none render. */
  actionsSlot?: HTMLElement | null;
  /** Element in the side panel where the caret bullet's comment card renders. With no slot, no card renders. */
  commentSlot?: HTMLElement | null;
  /**
   * Put the caret at the end of a bullet, scroll to it and show its card. Pass a new object (e.g. with an
   * incrementing `n`) each time. Works on iOS too, where focusing a field outside a tap is ignored.
   */
  reveal?: { id: string; n: number } | null;
  /**
   * After the job was marked Applied: no placeholder nags (tint, highlight, "replace before you apply"
   * card). Suggestions are hidden by passing no `feedback`.
   */
  quiet?: boolean;
  /** Called when the selection changes (null when nothing is selected). The coaching panel follows it. */
  onSelectionChange?: (selection: DocSelection | null) => void;
  /** Filled with the document commands (bold, italic, reset, paragraph style) on every render. */
  commandsRef?: React.RefObject<DocCommands | null>;
  /** Called when the caret line's formatting state changes. */
  onFormatStateChange?: (s: FormatState) => void;
};

/** Transaction metas. EXTERNAL: the change came from the page (undo, side panel), not the user typing. */
const EXTERNAL = "docExternal";
/** COMMIT: this change is its own undo step. */
const COMMIT = "docCommit";
/** REDECORATE: nothing changed in the doc, only the decoration options. */
const REDECORATE = "docRedecorate";

const PAGE_H = 1056;
const MARGIN = 58;
const LINE = 18;

const styleCls = (s: Required<TextStyle>) => `${s.bold ? "font-bold" : "font-normal"} ${s.italic ? "italic" : "not-italic"}`;

/** What the caret is in, as plain values (stored in React state for the toolbar, the card and the selection). */
type CaretSummary = {
  /** Index of the caret's line in the document. */
  index: number;
  /** Start position of the caret's line in the document. */
  pos: number;
  kind: LineKind;
  sid: string | null;
  iid: string | null;
  bid: string | null;
  /** Which part of the line the caret is in (null for bullets). */
  part: LinePart | null;
  text: string;
  bold: boolean;
  italic: boolean;
};

function summarize(state: EditorState): CaretSummary {
  const c = caretInfo(state);
  const attrs = c.line.attrs;
  const st = c.part ? lineEffectiveStyle(nodeToLine(c.line), c.part) : null;
  return {
    index: c.index,
    pos: c.pos,
    kind: c.kind,
    sid: attrs.sid ?? null,
    iid: attrs.iid ?? null,
    bid: attrs.bid ?? null,
    part: c.part,
    text: c.line.textContent,
    bold: st?.bold ?? false,
    italic: st?.italic ?? false,
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const sameStyle = (a: TextStyle | undefined, b: TextStyle | undefined) => a?.bold === b?.bold && a?.italic === b?.italic;

function selectionOf(c: CaretSummary): DocSelection | null {
  if (c.kind === "bullet") {
    return c.sid && c.iid && c.bid ? { kind: "bullet", sectionId: c.sid, entryId: c.iid, bulletId: c.bid } : null;
  }
  if (c.sid && c.iid && (c.kind === "entry" || c.kind === "role" || c.kind === "text")) {
    return { kind: "entry", sectionId: c.sid, entryId: c.iid };
  }
  if (c.sid && c.kind === "heading") return { kind: "section", sectionId: c.sid };
  return null;
}

/** Run a command on the editor's current state, then give the editor focus back. */
function runOn(view: EditorView | null, cmd: Command) {
  if (!view) return;
  cmd(view.state, (tr) => view.dispatch(tr));
  view.focus();
}

export function ResumeDocument({
  value, onChange, feedback, showHighlights = true, baseline, showChanges = true, onReject, onMeasure, actionsSlot,
  commentSlot, reveal, quiet = false, onSelectionChange, commandsRef, onFormatStateChange,
}: Props) {
  // Whether the editor's selection counts as selected: on while the editor or the toolbar/card is in use.
  const [selActive, setSelActiveState] = useState(false);
  const [caret, setCaret] = useState<CaretSummary | null>(null);

  const mountRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** The latest value prop (or the last Resume this editor emitted). */
  const valueRef = useRef<Resume>(value);
  /** The last Resume this editor emitted or synced; a value prop equal to it is our own echo. */
  const lastEmitted = useRef<Resume | null>(null);
  const caretRef = useRef<CaretSummary | null>(null);
  const selActiveRef = useRef(false);
  const propsRef = useRef<{
    onChange: Props["onChange"];
    onReject: Props["onReject"];
    onSelectionChange: Props["onSelectionChange"];
    onFormatStateChange: Props["onFormatStateChange"];
    decoOpts: Omit<DecorationOptions, "caretLine">;
  } | null>(null);

  const decoOpts = useMemo<Omit<DecorationOptions, "caretLine">>(
    () => ({ feedback, showHighlights, baseline, showChanges, quiet }),
    [feedback, showHighlights, baseline, showChanges, quiet],
  );

  // Latest callbacks and options for the editor's event handlers and plugins (read there, never during render).
  selActiveRef.current = selActive;
  propsRef.current = { onChange, onReject, onSelectionChange, onFormatStateChange, decoOpts };

  // Create the editor once. Strict mode mounts twice, so the cleanup destroys the first view.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const syncCaret = (state: EditorState) => {
      const summary = summarize(state);
      caretRef.current = summary;
      setCaret((prev) => (prev && sameJson(prev, summary) ? prev : summary));
    };

    // Decorations depend on the doc, the options and the caret line; cache on those.
    let deco: { doc: PMNode; opts: unknown; caretLine: number; set: DecorationSet } | null = null;
    const decorationsFor = (s: EditorState): DecorationSet => {
      const opts = propsRef.current?.decoOpts;
      if (!opts) return buildDecorations(s.doc, { showHighlights: false, showChanges: false, quiet: false, caretLine: -1 });
      const caretLine = selActiveRef.current ? caretInfo(s).index : -1;
      if (deco && deco.doc === s.doc && deco.opts === opts && deco.caretLine === caretLine) return deco.set;
      const set = buildDecorations(s.doc, { ...opts, caretLine });
      deco = { doc: s.doc, opts, caretLine, set };
      return set;
    };
    const decorationsPlugin = new Plugin({ props: { decorations: (s) => decorationsFor(s) } });

    // Write the resolved ids back onto the lines, then tell the page.
    const emit = (view: EditorView, before: EditorState, next: EditorState, forced: boolean) => {
      const lines = docToLines(next.doc);
      const { resume, ids } = linesToResume(lines, valueRef.current);

      const tr2 = view.state.tr;
      view.state.doc.forEach((node, offset, index) => {
        const want = ids[index];
        const a = node.attrs;
        if ((a.sid ?? null) !== (want.sid ?? null) || (a.iid ?? null) !== (want.iid ?? null) || (a.bid ?? null) !== (want.bid ?? null)) {
          tr2.setNodeMarkup(offset, undefined, { ...node.attrs, sid: want.sid ?? null, iid: want.iid ?? null, bid: want.bid ?? null });
        }
      });
      if (tr2.docChanged) {
        tr2.setMeta(EXTERNAL, true).setMeta("addToHistory", false);
        view.updateState(view.state.apply(tr2));
      }

      const prev = docToLines(before.doc);
      const commit =
        forced ||
        lines.length !== prev.length ||
        lines.some((l, i) => l.kind !== prev[i].kind || !sameStyle(l.style, prev[i].style) || !sameStyle(l.style2, prev[i].style2));

      lastEmitted.current = resume;
      valueRef.current = resume;
      propsRef.current?.onChange(resume, commit);
    };

    const dispatchTransaction = (tr: Transaction) => {
      const view = viewRef.current;
      if (!view) return;
      const before = view.state;
      const next = before.apply(tr); // includes headerGuard's appended fixes
      view.updateState(next);
      if (next.doc !== before.doc && !tr.getMeta(EXTERNAL)) emit(view, before, next, !!tr.getMeta(COMMIT));
      syncCaret(view.state);
    };

    const view = new EditorView(mount, {
      state: EditorState.create({
        doc: linesToDoc(resumeToLines(valueRef.current)),
        plugins: [headerGuard, ...editorKeymap(), decorationsPlugin],
      }),
      dispatchTransaction,
      attributes: { class: "doc-editor", spellcheck: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Resume" },
      clipboardTextParser: (text) => pasteTextParser(text),
      transformPasted: (slice) => stripPastedIds(slice),
      handleDOMEvents: {
        // Native undo would corrupt the doc; the app's history owns undo.
        beforeinput: (_v, e) => {
          const t = (e as InputEvent).inputType;
          if (t === "historyUndo" || t === "historyRedo") {
            e.preventDefault();
            return true;
          }
          return false;
        },
        focus: () => {
          setSelActiveState(true);
          return false;
        },
      },
    });
    viewRef.current = view;
    lastEmitted.current = valueRef.current;
    syncCaret(view.state);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // External changes (undo/redo, side-panel accept, coaching inserts, merges): rebuild the doc, keep the caret line.
  useEffect(() => {
    valueRef.current = value;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const view = viewRef.current;
    if (!view) return;

    const state = view.state;
    const newDoc = linesToDoc(resumeToLines(value));
    if (newDoc.eq(state.doc)) return;

    const c = caretInfo(state);
    const lineIndex = Math.min(c.index, newDoc.childCount - 1);
    let lineStart = 0;
    for (let i = 0; i < lineIndex; i++) lineStart += newDoc.child(i).nodeSize;
    const lineNode = newDoc.child(lineIndex);
    const offset = Math.min(c.offset, lineNode.content.size);

    const tr = state.tr.replaceWith(0, state.doc.content.size, newDoc.content);
    tr.setSelection(TextSelection.create(tr.doc, lineStart + 1 + offset));
    tr.setMeta(EXTERNAL, true);
    view.dispatch(tr);
  }, [value]);

  // Decoration options (or selection state, which moves the placeholders) changed: redraw without a doc change.
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(view.state.tr.setMeta(REDECORATE, true));
  }, [decoOpts, selActive]);

  // Selection is cleared by a pointer or focus outside the document, its toolbar and the comment card.
  // Menus and toolbars marked data-doc-keep-selection don't count as outside.
  // (Not on blur: iOS Safari never focuses buttons, so blur/relatedTarget can't tell a toolbar tap from leaving.)
  useEffect(() => {
    const outside = (t: EventTarget | null) => {
      const n = t as Node | null;
      if (!n || (t as Element | null)?.closest?.("[data-doc-keep-selection]")) return false;
      return !canvasRef.current?.contains(n) && !actionsSlot?.contains(n) && !commentSlot?.contains(n);
    };
    const onDown = (e: PointerEvent) => {
      if (outside(e.target)) setSelActiveState(false);
    };
    const onFocus = (e: FocusEvent) => {
      if (outside(e.target)) setSelActiveState(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [actionsSlot, commentSlot]);

  // A reveal request puts the caret at the end of its bullet, shows its card and scrolls to it.
  useEffect(() => {
    if (!reveal) return;
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc;
    let pos = 0;
    let hit = -1;
    for (let i = 0; i < doc.childCount; i++) {
      const node = doc.child(i);
      if (node.attrs.bid === reveal.id) {
        hit = pos;
        break;
      }
      pos += node.nodeSize;
    }
    if (hit < 0) return;
    const node = doc.nodeAt(hit);
    if (!node) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, hit + node.nodeSize - 1)));
    setSelActiveState(true);
    view.focus();
    (view.nodeDOM(hit) as HTMLElement | null)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [reveal]);

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

  // ---- derived state: the caret, only while the document counts as selected ----
  const caretOn = selActive ? caret : null;
  const sel = useMemo(() => (selActive && caret ? selectionOf(caret) : null), [selActive, caret]);
  const fmtState = useMemo<FormatState>(
    () => ({
      lineKind: selActive && caret ? caret.kind : null,
      canFormat: selActive && !!caret && caret.part !== null,
      bold: selActive && !!caret?.bold,
      italic: selActive && !!caret?.italic,
    }),
    [selActive, caret],
  );

  // Report selection and formatting changes by value, so re-renders with the same state don't fire.
  const lastSel = useRef<string | undefined>(undefined);
  useEffect(() => {
    const json = JSON.stringify(sel);
    if (lastSel.current === json) return;
    lastSel.current = json;
    propsRef.current?.onSelectionChange?.(sel);
  }, [sel]);
  const lastFmt = useRef<string | undefined>(undefined);
  useEffect(() => {
    const json = JSON.stringify(fmtState);
    if (lastFmt.current === json) return;
    lastFmt.current = json;
    propsRef.current?.onFormatStateChange?.(fmtState);
  }, [fmtState]);

  // The document commands, for the page's Format menu and shortcuts. They act on the caret's line.
  useEffect(() => {
    if (!commandsRef) return;
    commandsRef.current = {
      toggleBold: () => runOn(viewRef.current, toggleStyleCommand("bold")),
      toggleItalic: () => runOn(viewRef.current, toggleStyleCommand("italic")),
      resetFormat: () => runOn(viewRef.current, resetStyleCommand),
      setLineKind: (kind) => runOn(viewRef.current, setLineKindCommand(kind)),
    };
  });
  useEffect(() => {
    if (!commandsRef) return;
    return () => {
      commandsRef.current = null;
    };
  }, [commandsRef]);

  // On narrow screens the comment card is a bottom sheet that can cover the bullet being edited. Once the
  // card has rendered, scroll the bullet's line into view; the line's scroll-margin (globals.css) keeps it clear.
  // Desktop never scrolls on selection.
  const cardBid = caretOn && caretOn.kind === "bullet" ? caretOn.bid : null;
  useEffect(() => {
    if (!cardBid || window.innerWidth >= 1024) return;
    const frame = requestAnimationFrame(() => {
      if (!document.querySelector(`[data-comment-for="${cardBid}"]`)) return;
      const view = viewRef.current;
      const pos = caretRef.current?.pos;
      if (!view || pos === undefined) return;
      (view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [cardBid]);

  // ---- toolbar: paragraph style, bold, italic, bulleted list ----
  const headerLine = caretOn?.kind === "name" || caretOn?.kind === "contact";
  const kindOn = caretOn?.kind ?? null;
  const toolbar = actionsSlot ? (
    createPortal(
      <div role="toolbar" aria-label="Formatting" className="flex shrink-0 items-center gap-1">
        <select
          aria-label="Paragraph style"
          className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-fg"
          disabled={!caretOn || headerLine}
          value={kindOn ?? ""}
          onChange={(e) => runOn(viewRef.current, setLineKindCommand(e.target.value as LineKind))}
        >
          {!caretOn && <option value="" disabled>Paragraph style</option>}
          {headerLine && kindOn && <option value={kindOn} disabled>{kindOn === "name" ? "Name" : "Contact line"}</option>}
          {caretOn && !headerLine && LINE_KIND_LABELS.map((k) => (
            <option key={k.kind} value={k.kind}>{k.label}</option>
          ))}
        </select>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
        <button
          type="button"
          className="icon-btn aria-pressed:bg-surface-2 aria-pressed:text-fg"
          title="Bold (Ctrl+B)"
          aria-label="Bold (Ctrl+B)"
          aria-pressed={fmtState.bold}
          disabled={!fmtState.canFormat}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runOn(viewRef.current, toggleStyleCommand("bold"))}
        >
          <span className="text-[14px] leading-none font-bold">B</span>
        </button>
        <button
          type="button"
          className="icon-btn aria-pressed:bg-surface-2 aria-pressed:text-fg"
          title="Italic (Ctrl+I)"
          aria-label="Italic (Ctrl+I)"
          aria-pressed={fmtState.italic}
          disabled={!fmtState.canFormat}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runOn(viewRef.current, toggleStyleCommand("italic"))}
        >
          <span className="font-serif text-[16px] leading-none italic">I</span>
        </button>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
        <button
          type="button"
          className="icon-btn aria-pressed:bg-surface-2 aria-pressed:text-fg"
          title="Bulleted list"
          aria-label="Bulleted list"
          aria-pressed={kindOn === "bullet"}
          disabled={!caretOn || headerLine}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runOn(viewRef.current, setLineKindCommand(kindOn === "bullet" ? "text" : "bullet"))}
        >
          <ListIcon className="h-4 w-4" />
        </button>
      </div>,
      actionsSlot,
    )
  ) : null;

  // ---- comment card for the caret's bullet ----
  const card =
    commentSlot && caretOn && cardBid
      ? createPortal(
          <BulletCommentCard
            bulletId={cardBid}
            text={caretOn.text}
            info={bulletInfo(cardBid, caretOn.text, decoOpts)}
            showChanges={showChanges}
            quiet={quiet}
            onAccept={(text) => replaceBulletText(cardBid, text)}
            onRevert={(text) => replaceBulletText(cardBid, text)}
            onReject={onReject}
            onClose={() => setSelActiveState(false)}
            onSelectPlaceholder={(start, length) => selectInLine(caretOn.pos, start, length)}
          />,
          commentSlot,
        )
      : null;

  return (
    <>
      {toolbar}
      <div
        ref={canvasRef}
        className="doc-canvas"
        onPointerDownCapture={() => setSelActiveState(true)}
        onKeyDown={(e) => {
          // Escape clears the selection, unless a menu or popover inside the canvas already handled it.
          if (e.key === "Escape" && !e.defaultPrevented && !e.nativeEvent.isComposing) setSelActiveState(false);
        }}
      >
        <div className="doc-page">
          {/* Page-break guide (desktop only) */}
          <div aria-hidden className="doc-pagebreak" style={{ top: PAGE_H }}>
            <span>Page 2</span>
          </div>
          <div ref={contentRef} className="doc-content">
            <div ref={mountRef} />
          </div>
        </div>
      </div>
      {card}
    </>
  );

  /** Replace the caret bullet's text as its own undo step (Accept, Revert). */
  function replaceBulletText(bid: string, text: string) {
    const view = viewRef.current;
    if (!view) return;
    replaceLineTextCommand(bid, text)(view.state, (tr) => view.dispatch(tr.setMeta(COMMIT, true)));
    view.focus();
  }

  /** Select a [placeholder] inside the caret's line (char offsets within the line's text). */
  function selectInLine(linePos: number, start: number, length: number) {
    const view = viewRef.current;
    if (!view) return;
    const from = linePos + 1 + start;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + length)));
    view.focus();
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
            {value.header.name && <div className={`doc-name ${styleCls(effectiveStyle("name", value.header.styles?.name))}`}>{value.header.name}</div>}
            {value.header.contact && (
              <div className={`doc-contact ${styleCls(effectiveStyle("contact", value.header.styles?.contact))}`}>{value.header.contact}</div>
            )}
          </div>
          {value.sections.map((section) => (
            <section key={section.id} className="doc-section">
              <h3 className={`doc-section-title ${styleCls(effectiveStyle("sectionTitle", section.style))}`}>{section.title}</h3>
              {section.items.map((it) => {
                const st = (f: "title" | "subtitle" | "location" | "dates") => styleCls(effectiveStyle(f, it.styles?.[f], it));
                return isInlineItem(it) ? (
                  <div key={it.id} className="doc-entry">
                    {it.subtitle ? (
                      <>
                        <span className={st("title")}>{it.title}:</span> <span className={st("subtitle")}>{it.subtitle}</span>
                      </>
                    ) : (
                      <span className={st("title")}>{it.title}</span>
                    )}
                  </div>
                ) : (
                  <div key={it.id} className="doc-entry">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className={st("title")}>{it.title}</span>
                      <span className={`ml-auto ${st("location")}`}>{it.location}</span>
                    </div>
                    {(it.subtitle || it.dates) && (
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className={st("subtitle")}>{it.subtitle}</span>
                        <span className={`ml-auto ${st("dates")}`}>{it.dates}</span>
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
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
