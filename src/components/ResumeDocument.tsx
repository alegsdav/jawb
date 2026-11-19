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
import { docEquals, normalizeDoc, normalizeHref } from "@/lib/doc/model";
import { docExtensions } from "@/lib/doc/extensions";
import { PAGE_HEIGHT_IN, PX_PER_IN, firstLineOnNextPage } from "@/lib/docRender";
import { resumeDoc, withDoc } from "@/lib/resume";
import { bulletInfo } from "./docDecorations";
import { AiHighlights, paragraphPlainText, sameOptions, type HighlightOptions } from "./aiHighlights";
import { BulletCommentCard } from "./BulletCommentCard";
import { FormatToolbar } from "./FormatToolbar";
import { selectionFor, formatAt, linkHref } from "./editorState";
import { LinkPopover, type LinkAnchor } from "./LinkPopover";
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

/**
 * The line boxes of the editor's paragraphs, as tops and bottoms in unscaled px from the page's top. A text rect is
 * the glyphs' box, so it is centred in the line box the line-height gives (the PDF lays out line boxes). Measured on
 * the screen and divided by the zoom, so the result does not depend on it.
 */
function lineBoxesOf(content: HTMLElement, pageEl: HTMLElement): { top: number; bottom: number }[] {
  const page = pageEl.getBoundingClientRect();
  const scale = pageEl.offsetWidth > 0 ? page.width / pageEl.offsetWidth : 1;
  const boxes: { top: number; bottom: number }[] = [];
  for (const p of Array.from(content.querySelectorAll<HTMLElement>("p"))) {
    const style = getComputedStyle(p);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.15;
    const range = document.createRange();
    range.selectNodeContents(p);
    const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
    for (const r of rects.length ? rects : [p.getBoundingClientRect()]) {
      if (r.height <= 0) continue;
      const textTop = (r.top - page.top) / scale;
      const top = textTop - (lineHeight - r.height / scale) / 2;
      boxes.push({ top, bottom: top + lineHeight });
    }
  }
  return boxes;
}

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
function commandsFor(editor: Editor, openLink: () => void): DocCommands {
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
    setLink: (href) => {
      if (href === null) {
        chain().extendMarkRange("link").unsetLink().run();
        return;
      }
      const safe = normalizeHref(href);
      if (!safe) return;
      if (!editor.state.selection.empty) {
        chain().setLink({ href: safe }).run();
      } else if (linkHref(editor.state)) {
        // A caret in a link changes that whole link.
        chain().extendMarkRange("link").setLink({ href: safe }).run();
      } else {
        // A caret elsewhere: the address itself becomes the linked text.
        chain()
          .insertContent({ type: "text", text: safe, marks: [{ type: "link", attrs: { href: safe } }] })
          .run();
      }
    },
    openLink,
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
  align: "left", list: null, lineHeight: EMPTY_FORMAT_STATE.lineHeight, borderBottom: false, link: null, canUndo: false, canRedo: false,
};

export function ResumeDocument({
  value, onChange, feedback, showHighlights = true, baseline, showChanges = true, onReject, onMeasure, actionsSlot,
  commentSlot, reveal, quiet = false, onSelectionChange, commandsRef, onFormatStateChange,
}: Props) {
  // Whether the document counts as selected: on while the editor or its toolbar/card is in use.
  const [selActive, setSelActive] = useState(false);
  const [caret, setCaret] = useState<CaretState>(NO_CARET);
  const [fmt, setFmt] = useState<Omit<FormatState, "active">>(EMPTY_FMT);
  /** The link box in edit mode, at a document position, with the href it starts from. */
  const [editing, setEditing] = useState<{ pos: number; href: string } | null>(null);
  /** The link around a caret (shown as a bubble with its URL), or null. */
  const [bubble, setBubble] = useState<{ pos: number; href: string } | null>(null);
  /** Bumped on scroll and resize so the link box and bubble follow the text. */
  const [, setViewTick] = useState(0);
  const openLinkRef = useRef<() => void>(() => {});

  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  /** Where page 2 starts, in px from the page's top (null when the resume fits on page 1). */
  const [page2Top, setPage2Top] = useState<number | null>(null);
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
      // normalizeDoc drops the editor's default link attrs (target, rel), so stored links hold only the href.
      const next = withDoc(valueRef.current, normalizeDoc(ed.getJSON()));
      lastEmitted.current = next;
      valueRef.current = next;
      latest.current.onChange(next);
    },
    onTransaction: ({ editor: ed, transaction }) => {
      setFmt(formatAt(ed));
      syncCaret(ed, transaction.docChanged);
      syncBubble(ed);
    },
  });

  /** The link around a collapsed selection, for the bubble. */
  function syncBubble(ed: Editor) {
    const { selection } = ed.state;
    const mark = selection.empty ? selection.$from.marks().find((m) => m.type.name === "link") : undefined;
    const next = mark ? { pos: selection.from, href: String(mark.attrs.href) } : null;
    setBubble((prev) => (prev?.pos === next?.pos && prev?.href === next?.href ? prev : next));
  }

  /** Opens the link box at the selection: the link's address, or empty for a new link. */
  function openLink() {
    if (!editor) return;
    setSelActive(true);
    setEditing({ pos: editor.state.selection.from, href: linkHref(editor.state) ?? "" });
  }
  openLinkRef.current = openLink;

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

  const commands = useMemo(() => (editor ? commandsFor(editor, () => openLinkRef.current()) : null), [editor]);

  // The link box and bubble follow scrolling and resizing (their anchor is a viewport position).
  useEffect(() => {
    if (!editing && !bubble) return;
    const bump = () => setViewTick((t) => t + 1);
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    return () => {
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
    };
  }, [editing, bubble]);

  /** Where the text at a document position is on screen (null when the editor cannot place it). */
  const anchorAt = (pos: number): LinkAnchor | null => {
    if (!editor) return null;
    try {
      const c = editor.view.coordsAtPos(pos);
      return { top: c.top, bottom: c.bottom, left: c.left };
    } catch {
      return null;
    }
  };

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
    const pageEl = pageRef.current;
    if (!el || !pageEl || !onMeasure) return;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth < 600) return; // reflowed phone layout isn't page-accurate
      const page = valueRef.current.page ?? PAGE_DEFAULTS;
      const usable = PAGE_HEIGHT_IN * PX_PER_IN - (page.marginTop + page.marginBottom) * PX_PER_IN;
      const h = el.scrollHeight;
      // Lines are counted from their own boxes: a 9pt line is shorter than an 11pt one, so a height gives the wrong count.
      const pageBottom = (PAGE_HEIGHT_IN - page.marginBottom) * PX_PER_IN;
      const overflowLines = lineBoxesOf(el, pageEl).filter((b) => b.bottom > pageBottom).length;
      onMeasure({ pages: Math.max(1, Math.ceil(h / usable)), overflowLines });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);

  // Page 2 starts at the first line that does not fit above the bottom margin (the PDF moves that line whole). The
  // line boxes change with every edit, with a resize or a font load, so the marker is measured again on each.
  const marginBottom = value.page?.marginBottom ?? PAGE_DEFAULTS.marginBottom;
  useEffect(() => {
    const content = contentRef.current;
    const pageEl = pageRef.current;
    if (!editor || !content || !pageEl) return;
    const measure = () => {
      if (content.offsetWidth < 600) return setPage2Top(null); // the phone layout reflows: no page breaks there
      const pageBottom = (PAGE_HEIGHT_IN - marginBottom) * PX_PER_IN;
      setPage2Top(firstLineOnNextPage(lineBoxesOf(content, pageEl), pageBottom));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    editor.on("update", measure);
    const fonts = document.fonts;
    fonts?.addEventListener?.("loadingdone", measure);
    void fonts?.ready.then(measure);
    return () => {
      ro.disconnect();
      editor.off("update", measure);
      fonts?.removeEventListener?.("loadingdone", measure);
    };
  }, [editor, marginBottom]);

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

  const editAnchor = editing ? anchorAt(editing.pos) : null;
  const bubbleAnchor = bubble && selActive && !editing ? anchorAt(bubble.pos) : null;

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
          // Ctrl/Cmd+K opens the link box.
          if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
            e.preventDefault();
            openLink();
            return;
          }
          // Escape clears the selection, unless a menu or popover inside the canvas already handled it.
          if (e.key === "Escape" && !e.defaultPrevented && !e.nativeEvent.isComposing) setSelActive(false);
        }}
      >
        <div ref={pageRef} className="doc-page" style={{ padding: `${page.marginTop}in ${page.marginRight}in ${page.marginBottom}in ${page.marginLeft}in` }}>
          {/* Page-break guide (desktop only): the line where page 2 begins */}
          {page2Top !== null && (
            <div aria-hidden className="doc-pagebreak" style={{ top: page2Top }}>
              <span>Page 2</span>
            </div>
          )}
          <div ref={contentRef} className="doc-content">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      {card}
      {editing && editAnchor && commands && (
        <LinkPopover
          anchor={editAnchor}
          mode="edit"
          href={editing.href}
          onApply={(raw) => {
            const href = normalizeHref(raw);
            if (!href) return false;
            commands.setLink(href);
            setEditing(null);
            return true;
          }}
          onRemove={() => {
            commands.setLink(null);
            setEditing(null);
          }}
          onEdit={() => {}}
          onClose={(refocus) => {
            setEditing(null);
            if (refocus) editor?.commands.focus();
          }}
        />
      )}
      {!editing && bubble && selActive && bubbleAnchor && commands && (
        <LinkPopover
          anchor={bubbleAnchor}
          mode="bubble"
          href={bubble.href}
          onApply={() => false}
          onRemove={() => commands.setLink(null)}
          onEdit={() => setEditing(bubble)}
          onClose={() => {}}
        />
      )}
    </>
  );
}

