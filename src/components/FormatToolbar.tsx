"use client";

import { FONT_CHOICES } from "@/lib/doc/fonts";
import { UndoRedo } from "./DocToolbar";
import { LinkIcon, ListIcon, NumberedListIcon } from "./icons";
import { FONT_SIZES, type DocCommands, type FormatState, type MarkName } from "./editorTypes";

const MARKS: { name: MarkName; title: string; glyph: string; glyphClass: string }[] = [
  { name: "bold", title: "Bold (Ctrl+B)", glyph: "B", glyphClass: "text-[14px] font-bold" },
  { name: "italic", title: "Italic (Ctrl+I)", glyph: "I", glyphClass: "font-serif text-[16px] italic" },
  { name: "underline", title: "Underline (Ctrl+U)", glyph: "U", glyphClass: "text-[14px] underline" },
];

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;

/** A toolbar button: stays enabled only with a selection; keeps the editor's focus on press. */
const btnClass = "icon-btn shrink-0 aria-pressed:bg-surface-2 aria-pressed:text-fg";

/**
 * The formatting toolbar: undo/redo, font, size, bold/italic/underline/link, lists. Alignment, indent, spacing,
 * tab stops and clear formatting live in the Format menu. One row that scrolls sideways on phones, never wraps.
 */
export function FormatToolbar({ fmt, commands }: { fmt: FormatState; commands: DocCommands }) {
  const on = fmt.active;
  // Without a focused editor the marks describe nothing, so the selects go blank and nothing shows pressed.
  const font = on ? fmt.fontFamily : null;
  const size = on ? fmt.fontSize : null;
  const families = font && !(FONT_CHOICES as readonly string[]).includes(font)
    ? [...FONT_CHOICES, font]
    : FONT_CHOICES;
  const sizes = size !== null && !(FONT_SIZES as readonly number[]).includes(size)
    ? [...FONT_SIZES, size].sort((a, b) => a - b)
    : FONT_SIZES;

  return (
    <div role="toolbar" aria-label="Formatting" className="flex min-w-0 flex-nowrap items-center gap-1">
      <UndoRedo undo={commands.undo} redo={commands.redo} canUndo={fmt.canUndo} canRedo={fmt.canRedo} />
      <Sep />
      <select
        aria-label="Font"
        className="h-8 w-36 max-w-full shrink-0 rounded-md border border-border bg-surface px-2 text-sm text-fg"
        disabled={!on}
        value={font ?? ""}
        onChange={(e) => commands.setFontFamily(e.target.value)}
      >
        {font === null && <option value="" disabled />}
        {families.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <select
        aria-label="Font size"
        className="h-8 w-[4.5rem] shrink-0 rounded-md border border-border bg-surface px-2 text-sm text-fg"
        disabled={!on}
        value={size === null ? "" : String(size)}
        onChange={(e) => commands.setSize(Number(e.target.value))}
      >
        {size === null && <option value="" disabled />}
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
          aria-pressed={on && fmt[b.name]}
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
        aria-pressed={on && fmt.link !== null}
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
        aria-pressed={on && fmt.list === "bullet"}
        disabled={!on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commands.toggleList("bullet")}
      >
        <ListIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btnClass}
        title="Numbered list"
        aria-label="Numbered list"
        aria-pressed={on && fmt.list === "ordered"}
        disabled={!on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commands.toggleList("ordered")}
      >
        <NumberedListIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
