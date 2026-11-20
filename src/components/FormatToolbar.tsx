"use client";

import { FONT_CHOICES } from "@/lib/doc/fonts";
import { UndoRedo } from "./DocToolbar";
import { LinkIcon, ListIcon } from "./icons";
import { FONT_SIZES, type DocCommands, type FormatState, type MarkName } from "./editorTypes";

const MARKS: { name: MarkName; title: string; glyph: string; glyphClass: string }[] = [
  { name: "bold", title: "Bold (Ctrl+B)", glyph: "B", glyphClass: "text-[14px] font-bold" },
  { name: "italic", title: "Italic (Ctrl+I)", glyph: "I", glyphClass: "font-serif text-[16px] italic" },
  { name: "underline", title: "Underline (Ctrl+U)", glyph: "U", glyphClass: "text-[14px] underline" },
];

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;

/** A toolbar button: stays enabled only with a selection; keeps the editor's focus on press. */
const btnClass = "icon-btn shrink-0 aria-pressed:bg-surface-2 aria-pressed:text-fg";
const textBtnClass = "btn btn-sm shrink-0 min-h-8 px-2 text-[13px]";

/**
 * The formatting toolbar: undo/redo, font, size, bold/italic/underline/link, lists. Alignment, indent, spacing,
 * tab stops and clear formatting live in the Format menu. One row that scrolls sideways on phones, never wraps.
 */
export function FormatToolbar({ fmt, commands }: { fmt: FormatState; commands: DocCommands }) {
  const on = fmt.active;
  const families = fmt.fontFamily && !(FONT_CHOICES as readonly string[]).includes(fmt.fontFamily)
    ? [...FONT_CHOICES, fmt.fontFamily]
    : FONT_CHOICES;
  const sizes = fmt.fontSize !== null && !(FONT_SIZES as readonly number[]).includes(fmt.fontSize)
    ? [...FONT_SIZES, fmt.fontSize].sort((a, b) => a - b)
    : FONT_SIZES;

  return (
    <div role="toolbar" aria-label="Formatting" className="flex min-w-0 flex-nowrap items-center gap-1">
      <UndoRedo undo={commands.undo} redo={commands.redo} canUndo={fmt.canUndo} canRedo={fmt.canRedo} />
      <Sep />
      <select
        aria-label="Font"
        className="h-8 w-36 max-w-full shrink-0 rounded-md border border-border bg-surface px-2 text-sm text-fg"
        disabled={!on}
        value={fmt.fontFamily ?? ""}
        onChange={(e) => commands.setFontFamily(e.target.value)}
      >
        {fmt.fontFamily === null && <option value="" disabled />}
        {families.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <select
        aria-label="Font size"
        className="h-8 w-[4.5rem] shrink-0 rounded-md border border-border bg-surface px-2 text-sm text-fg"
        disabled={!on}
        value={fmt.fontSize === null ? "" : String(fmt.fontSize)}
        onChange={(e) => commands.setSize(Number(e.target.value))}
      >
        {fmt.fontSize === null && <option value="" disabled />}
        {sizes.map((pt) => (
          <option key={pt} value={String(pt)}>{pt}</option>
        ))}
      </select>
      <Sep />
      {MARKS.map((b) => (
        <button
          key={b.name}
          type="button"
          className={btnClass}
          title={b.title}
          aria-label={b.title}
          aria-pressed={fmt[b.name]}
          disabled={!on}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commands.toggleMark(b.name)}
        >
          <span className={`leading-none ${b.glyphClass}`}>{b.glyph}</span>
        </button>
      ))}
      <button
        type="button"
        className={btnClass}
        title="Insert link (Ctrl+K)"
        aria-label="Insert link"
        aria-pressed={fmt.link !== null}
        disabled={!on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commands.openLink()}
      >
        <LinkIcon className="h-4 w-4" />
      </button>
      <Sep />
      <button
        type="button"
        className={btnClass}
        title="Bulleted list"
        aria-label="Bulleted list"
        aria-pressed={fmt.list === "bullet"}
        disabled={!on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commands.toggleList("bullet")}
      >
        <ListIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={textBtnClass}
        title="Numbered list"
        aria-label="Numbered list"
        aria-pressed={fmt.list === "ordered"}
        disabled={!on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commands.toggleList("ordered")}
      >
        1. 2.
      </button>
    </div>
  );
}
