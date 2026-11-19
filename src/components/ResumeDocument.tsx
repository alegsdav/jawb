"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Extension, type Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import type { BulletFeedback } from "@/lib/analysis";
import type { Resume } from "@/lib/types";
import { PAGE_DEFAULTS, type DocJSON, type PageSetup } from "@/lib/doc/types";
import { docEquals, normalizeDoc } from "@/lib/doc/model";
import { docExtensions } from "@/lib/doc/extensions";
import { resumeDoc, withDoc } from "@/lib/resume";
import { bulletInfo } from "./docDecorations";
import { AiHighlights, paragraphPlainText, sameOptions, type HighlightOptions } from "./aiHighlights";
import { BulletCommentCard } from "./BulletCommentCard";
import { FormatToolbar } from "./FormatToolbar";
import { selectionFor, formatAt } from "./editorState";
import { EMPTY_FORMAT_STATE, type DocCommands, type DocSelection, type FormatState } from "./editorTypes";

export type { DocCommands, DocSelection, FormatState } from "./editorTypes";
export { ResumeView } from "./ResumeView";

type Props = {
  value: Resume;
  /** Called with the whole resume after every edit made in the document. */
  onChange: (r: Resume) => void;
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
  /** Put the caret at the end of a paragraph (a bullet's id), scroll to it and show its card. Pass a new object each time. */
  reveal?: { id: string; n: number } | null;
  /** After the job was marked Applied: no placeholder nags. Suggestions are hidden by passing no `feedback`. */
  quiet?: boolean;
  /** Called when the selection changes (null when nothing is selected). The coaching panel follows it. */
  onSelectionChange?: (selection: DocSelection | null) => void;
  /** Filled with the document commands on every render. */
  commandsRef?: React.RefObject<DocCommands | null>;
  /** Called when the caret's formatting state changes. */
  onFormatStateChange?: (s: FormatState) => void;
};

/** Transaction meta: the change came from the page (an accepted rewrite, a pull, an import), not from typing. */
const EXTERNAL = "docExternal";

/** Page geometry in px (1in = 96px). US Letter height. */
const PX_PER_IN = 96;
const PAGE_H = 11 * PX_PER_IN;
/** One line of 11pt text at 1.15 line height, in px. */
const LINE = 16.87;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docShortcuts: {
      /** Removes text marks and paragraph formatting from the selected paragraphs. */
      clearFormatting: () => ReturnType;
    };
  }
}

/** Clear formatting (Ctrl/Cmd+\) and its command. */
const DocShortcuts = Extension.create({
  name: "docShortcuts",

  addCommands() {
    return {
      clearFormatting: () => ({ chain, editor }) => {
        const hadRule = !!editor.getAttributes("paragraph").borderBottom;
        const c = chain()
          .unsetAllMarks()
          .unsetTextAlign()
          .setLineHeight(null)
          .setSpaceBefore(null)
          .setSpaceAfter(null);
        if (hadRule) c.toggleBorderBottom();
        return c.run();
      },
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-\\": () => this.editor.commands.clearFormatting() };
  },
});

const EXTENSIONS = [...docExtensions, AiHighlights, DocShortcuts];

/** Every command the toolbar and the menus use, bound to this editor. Each one refocuses the editor. */
function commandsFor(editor: Editor): DocCommands {
  const chain = () => editor.chain().focus();
  const adjust = (key: "spaceBefore" | "spaceAfter", delta: number) => {
    const cur = Number(editor.getAttributes("paragraph")[key] ?? 0);
    const next = Math.max(0, cur + delta) || null;
    if (key === "spaceBefore") chain().setSpaceBefore(next).run();
    else chain().setSpaceAfter(next).run();
  };
  return {
    undo: () => chain().undo().run(),
    redo: () => chain().redo().run(),
    toggleMark: (mark) => {
      if (mark === "bold") chain().toggleBold().run();
      else if (mark === "italic") chain().toggleItalic().run();
      else chain().toggleUnderline().run();
    },
    setSize: (pt) => chain().setFontSize(`${pt}pt`).run(),
    setFontFamily: (family) => chain().setFontFamily(family).run(),
    setAlign: (align) => chain().setTextAlign(align).run(),
    toggleList: (kind) => {
      if (kind === "bullet") chain().toggleBulletList().run();
      else chain().toggleOrderedList().run();
    },
    indent: () => chain().sinkListItem("listItem").run(),
    outdent: () => chain().liftListItem("listItem").run(),
    setLineHeight: (multiple) => chain().setLineHeight(multiple).run(),
    adjustSpaceBefore: (delta) => adjust("spaceBefore", delta),
    adjustSpaceAfter: (delta) => adjust("spaceAfter", delta),
    toggleBorderBottom: () => chain().toggleBorderBottom().run(),
    insertHorizontalLine: () => insertHorizontalLine(editor),
    clearFormatting: () => {
      editor.commands.focus();
      editor.commands.clearFormatting();
    },
  };
}

/**
 * Google Docs style horizontal line: an empty paragraph with a bottom border after the caret's block, then an empty
 * normal paragraph under it with the caret in it, so the user keeps typing below the line.
 */
function insertHorizontalLine(editor: Editor) {
  const at = editor.state.selection.$from.after(1); // after the top-level block (or list) the caret is in
  editor
    .chain()
    .focus()
    .insertContentAt(at, [{ type: "paragraph", attrs: { borderBottom: true } }, { type: "paragraph" }])
    .setTextSelection(at + 3) // inside the second paragraph: open + close of the line, then its open token
    .run();
}

/**
 * Replaces the whole document with `doc` as ONE undoable step, keeping the caret where it was (clamped).
 * Not reported back to the page: the page already has this value.
 */
function applyExternalDoc(editor: Editor, doc: DocJSON) {
  if (docEquals(doc, editor.getJSON() as DocJSON)) return;
  const node = editor.schema.nodeFromJSON(normalizeDoc(doc));
  const { state } = editor;
  const tr = closeHistory(state.tr.replaceWith(0, state.doc.content.size, node.content));
  const at = Math.min(state.selection.from, tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(at)));
  tr.setMeta(EXTERNAL, true);
  editor.view.dispatch(tr);
  editor.view.dispatch(closeHistory(editor.state.tr));
}

/** Replaces the caret paragraph's text as one undoable step (Accept suggestion, Revert to master). */
function replaceCaretText(editor: Editor, text: string) {
  const { $from } = editor.state.selection;
  const from = $from.start();
  const to = $from.end();
  const marks = $from.parent.firstChild?.marks ?? [];
  const tr = closeHistory(editor.state.tr);
  if (text) tr.replaceWith(from, to, editor.schema.text(text, marks));
  else tr.delete(from, to);
  tr.setSelection(TextSelection.create(tr.doc, from + text.length));
  editor.view.dispatch(tr);
}

type CaretState = { id: string | null; text: string; sel: DocSelection | null };
const NO_CARET: CaretState = { id: null, text: "", sel: null };
/** The formatting state before the editor exists (without `active`). */
const EMPTY_FMT: Omit<FormatState, "active"> = {
  bold: false, italic: false, underline: false, fontFamily: EMPTY_FORMAT_STATE.fontFamily, fontSize: EMPTY_FORMAT_STATE.fontSize,
  align: "left", list: null, lineHeight: EMPTY_FORMAT_STATE.lineHeight, borderBottom: false, canUndo: false, canRedo: false,
};

export function ResumeDocument({
  value, onChange, feedback, showHighlights = true, baseline, showChanges = true, onReject, onMeasure, actionsSlot,
  commentSlot, reveal, quiet = false, onSelectionChange, commandsRef, onFormatStateChange,
}: Props) {
  // Whether the document counts as selected: on while the editor or its toolbar/card is in use.
  const [selActive, setSelActive] = useState(false);
  const [caret, setCaret] = useState<CaretState>(NO_CARET);
  const [fmt, setFmt] = useState<Omit<FormatState, "active">>(EMPTY_FMT);

  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** The latest resume: the page's value, or the last one this editor emitted. */
  const valueRef = useRef<Resume>(value);
  /** The last resume this editor emitted or was given; a value prop equal to it is our own echo. */
  const lastEmitted = useRef<Resume>(value);
  const caretRef = useRef<CaretState>(NO_CARET);
  // Latest callbacks for the editor's event handlers (read there, never during render).
  const latest = useRef({ onChange, onSelectionChange, onFormatStateChange });
  latest.current = { onChange, onSelectionChange, onFormatStateChange };

  // useEditor re-applies its options (resetting the view's selection to the editor state) whenever an option
  // is a new object, so the initial content and the editor props are created once.
  const [initialContent] = useState(() => resumeDoc(value));
  const [editorProps] = useState(() => ({
    attributes: { class: "doc-editor", spellcheck: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Resume" },
    handleDOMEvents: {
      focus: () => {
        setSelActive(true);
        return false;
      },
    },
  }));
  const editor = useEditor({
    immediatelyRender: false,
    extensions: EXTENSIONS,
    content: initialContent,
    editorProps,
    onUpdate: ({ editor: ed, transaction }) => {
      if (transaction.getMeta(EXTERNAL)) return;
      const next = withDoc(valueRef.current, ed.getJSON() as DocJSON);
      lastEmitted.current = next;
      valueRef.current = next;
      latest.current.onChange(next);
    },
    onTransaction: ({ editor: ed, transaction }) => {
      setFmt(formatAt(ed));
      syncCaret(ed, transaction.docChanged);
    },
  });

  /** Tracks the caret paragraph: its id, text and coaching selection. */
  function syncCaret(ed: Editor, docChanged: boolean) {
    const para = ed.state.selection.$from.parent;
    const id = (para.attrs.id as string | null) ?? null;
    const text = paragraphPlainText(para);
    const prev = caretRef.current;
    const sel = docChanged || prev.id !== id ? (id ? selectionFor(ed.getJSON() as DocJSON, id) : null) : prev.sel;
    if (prev.id === id && prev.text === text && prev.sel === sel) return;
    const next = { id, text, sel };
    caretRef.current = next;
    setCaret(next);
  }

  const commands = useMemo(() => (editor ? commandsFor(editor) : null), [editor]);

  // The page's value changed from outside (an accepted rewrite, a pull, an import): apply it as one undoable step.
  useEffect(() => {
    valueRef.current = value;
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    applyExternalDoc(editor, resumeDoc(value));
  }, [value, editor]);

  // AI highlights: options change the decorations only, never the document or its history.
  // Only real changes dispatch: a transaction from a re-render can land between the browser moving the caret
  // (arrow keys) and ProseMirror reading it, and would put the caret back.
  const lastHighlights = useRef<HighlightOptions | null>(null);
  useEffect(() => {
    const opts: HighlightOptions = { feedback, showHighlights, baseline, showChanges, quiet };
    if (!editor || (lastHighlights.current && sameOptions(lastHighlights.current, opts))) return;
    lastHighlights.current = opts;
    editor.commands.setHighlightOptions(opts);
  }, [editor, feedback, showHighlights, baseline, showChanges, quiet]);

  // Selection is cleared by a pointer or focus outside the document, its toolbar and the comment card.
  // Menus and toolbars marked data-doc-keep-selection don't count as outside.
  useEffect(() => {
    const outside = (t: EventTarget | null) => {
      const n = t as Node | null;
      if (!n || (t as Element | null)?.closest?.("[data-doc-keep-selection]")) return false;
      return !canvasRef.current?.contains(n) && !actionsSlot?.contains(n) && !commentSlot?.contains(n);
    };
    const onDown = (e: PointerEvent) => {
      if (outside(e.target)) setSelActive(false);
    };
    const onFocus = (e: FocusEvent) => {
      if (outside(e.target)) setSelActive(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [actionsSlot, commentSlot]);

  // A reveal request puts the caret at the end of its paragraph, shows its card and scrolls to it.
  useEffect(() => {
    if (!reveal || !editor) return;
    let found: { pos: number; size: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type.name === "paragraph" && node.attrs.id === reveal.id) found = { pos, size: node.nodeSize };
      return !found;
    });
    if (!found) return;
    const hit: { pos: number; size: number } = found;
    editor.chain().focus().setTextSelection(hit.pos + hit.size - 1).run();
    setSelActive(true);
    (editor.view.nodeDOM(hit.pos) as HTMLElement | null)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [reveal, editor]);

  // Page-length measurement, with the page's own margins.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !onMeasure) return;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth < 600) return; // reflowed phone layout isn't page-accurate
      const page = valueRef.current.page ?? PAGE_DEFAULTS;
      const usable = PAGE_H - (page.marginTop + page.marginBottom) * PX_PER_IN;
      const h = el.scrollHeight;
      onMeasure({ pages: Math.max(1, Math.ceil(h / usable)), overflowLines: Math.max(0, Math.ceil((h - usable) / LINE)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);

  // The document commands, for the toolbar, the menus and the shortcuts.
  useEffect(() => {
    if (!commandsRef) return;
    commandsRef.current = commands;
    return () => {
      commandsRef.current = null;
    };
  }, [commandsRef, commands]);

  // ---- derived state: only while the document counts as selected ----
  const page: PageSetup = value.page ?? PAGE_DEFAULTS;
  const fmtState = useMemo<FormatState>(() => ({ ...fmt, active: selActive }), [fmt, selActive]);
  const sel = selActive ? caret.sel : null;
  const selKey = JSON.stringify(sel);
  const lastSel = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastSel.current === selKey) return;
    lastSel.current = selKey;
    latest.current.onSelectionChange?.(sel);
  }, [selKey, sel]);

  const fmtKey = JSON.stringify(fmtState);
  const lastFmt = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastFmt.current === fmtKey) return;
    lastFmt.current = fmtKey;
    latest.current.onFormatStateChange?.(fmtState);
  }, [fmtKey, fmtState]);

  // On narrow screens the comment card is a bottom sheet that can cover the bullet being edited. Once the
  // card has rendered, scroll the caret's paragraph into view. Desktop never scrolls on selection.
  const cardId = sel?.kind === "bullet" ? caret.id : null;
  useEffect(() => {
    if (!cardId || !editor || window.innerWidth >= 1024) return;
    const frame = requestAnimationFrame(() => {
      if (!document.querySelector(`[data-comment-for="${cardId}"]`)) return;
      const { $from } = editor.state.selection;
      (editor.view.nodeDOM($from.before($from.depth)) as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [cardId, editor]);

  const toolbar =
    actionsSlot && commands
      ? createPortal(<FormatToolbar fmt={fmtState} commands={commands} />, actionsSlot)
      : null;

  const card =
    commentSlot && cardId && commands
      ? createPortal(
          <BulletCommentCard
            bulletId={cardId}
            text={caret.text}
            info={bulletInfo(cardId, caret.text, { feedback, baseline })}
            showChanges={showChanges}
            quiet={quiet}
            onAccept={(text) => editor && replaceCaretText(editor, text)}
            onRevert={(text) => editor && replaceCaretText(editor, text)}
            onReject={onReject}
            onClose={() => setSelActive(false)}
            onSelectPlaceholder={(start, length) => selectInCaret(start, length)}
          />,
          commentSlot,
        )
      : null;

  /** Select a [placeholder] inside the caret's paragraph (char offsets within its text). */
  function selectInCaret(start: number, length: number) {
    if (!editor) return;
    const from = editor.state.selection.$from.start() + start;
    editor.chain().focus().setTextSelection({ from, to: from + length }).run();
  }

  return (
    <>
      {toolbar}
      <div
        ref={canvasRef}
        className="doc-canvas"
        onPointerDownCapture={() => setSelActive(true)}
        onKeyDown={(e) => {
          // Escape clears the selection, unless a menu or popover inside the canvas already handled it.
          if (e.key === "Escape" && !e.defaultPrevented && !e.nativeEvent.isComposing) setSelActive(false);
        }}
      >
        <div className="doc-page" style={{ padding: `${page.marginTop}in ${page.marginRight}in ${page.marginBottom}in ${page.marginLeft}in` }}>
          {/* Page-break guide (desktop only) */}
          <div aria-hidden className="doc-pagebreak" style={{ top: PAGE_H - page.marginBottom * PX_PER_IN }}>
            <span>Page 2</span>
          </div>
          <div ref={contentRef} className="doc-content">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      {card}
    </>
  );
}

