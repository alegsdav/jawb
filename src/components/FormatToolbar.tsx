"use client";

import type { ReactNode } from "react";
import { FONT_CHOICES } from "@/lib/doc/fonts";
import { ToolbarSep, UndoRedo } from "./DocToolbar";
import { LinkIcon, ListIcon, NumberedListIcon } from "./icons";
import { FONT_SIZES, type DocCommands, type FormatState, type MarkName } from "./editorTypes";

const MARKS: { name: MarkName; title: string; glyph: string; glyphClass: string }[] = [
  { name: "bold", title: "Bold (Ctrl+B)", glyph: "B", glyphClass: "text-[14px] font-bold" },
  { name: "italic", title: "Italic (Ctrl+I)", glyph: "I", glyphClass: "font-serif text-[16px] italic" },
  { name: "underline", title: "Underline (Ctrl+U)", glyph: "U", glyphClass: "text-[14px] underline" },
];

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;

/**
 * The native select is transparent and covers the chip, so clicks, keyboard use and its dropdown still belong to the
 * select. The visible text and a small chevron come from the chip itself, which sizes to its content, so the arrow sits
 * right after the value instead of at the far edge of a box.
 */
const SELECT_CLASS =
  "absolute inset-0 h-full w-full min-w-0 cursor-pointer appearance-none bg-surface text-sm text-fg opacity-0 outline-none";

function SelectChip({ label, textClass, children }: { label: string; textClass?: string; children: ReactNode }) {
  return (
    <div className="relative inline-flex h-8 max-w-full shrink-0 items-center rounded-md hover:bg-surface-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-fg/40">
      <span aria-hidden className="pointer-events-none flex min-w-0 items-center gap-1 pl-2 pr-1.5 text-sm text-fg">
        <span className={textClass}>{label}</span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </span>
      {children}
    </div>
  );
}

/**
 * A toolbar button. Never disabled: it keeps the editor's focus on press, so its command applies to the editor's
 * selection, and `aria-pressed` shows the marks at that selection.
 */
const btnClass = "icon-btn shrink-0 aria-pressed:bg-surface-2 aria-pressed:text-fg";

/**
 * The formatting toolbar: undo/redo, font, size, bold/italic/underline/link, lists. Alignment, indent, spacing,
 * tab stops and clear formatting live in the Format menu. One row that scrolls sideways on phones, never wraps.
 *
 * It always looks enabled, whether or not the editor has focus. The selects show the font and size of the selection
 * (`fmt.fontFamily`, `fmt.fontSize`), which stay current while the editor is blurred. Every control runs a command
 * from ResumeDocument's commandsFor, and each of those starts with `chain().focus()`: that refocuses the editor and
 * applies the change to the selection it kept. Before the editor exists the pages pass EMPTY_FORMAT_STATE and
 * NOOP_COMMANDS, so the same row shows with empty selects.
 */
export function FormatToolbar({ fmt, commands }: { fmt: FormatState; commands: DocCommands }) {
  const font = fmt.fontFamily;
  const size = fmt.fontSize;
  const families = font && !(FONT_CHOICES as readonly string[]).includes(font)
    ? [...FONT_CHOICES, font]
    : FONT_CHOICES;
  const sizes = size !== null && !(FONT_SIZES as readonly number[]).includes(size)
    ? [...FONT_SIZES, size].sort((a, b) => a - b)
    : FONT_SIZES;

  return (
    <div role="toolbar" aria-label="Formatting" className="flex min-w-0 flex-nowrap items-center gap-1">
      <UndoRedo undo={commands.undo} redo={commands.redo} />
      <Sep />
      <SelectChip label={font ?? ""} textClass="max-w-[9.5rem] min-w-[4.5rem] truncate">
        <select
          aria-label="Font"
          className={SELECT_CLASS}
          value={font ?? ""}
          onChange={(e) => commands.setFontFamily(e.target.value)}
        >
          {font === null && <option value="" disabled />}
          {families.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </SelectChip>
      <ToolbarSep />
      <SelectChip label={size === null ? "" : String(size)} textClass="min-w-[1.25rem]">
        <select
          aria-label="Font size"
          className={SELECT_CLASS}
          value={size === null ? "" : String(size)}
          onChange={(e) => commands.setSize(Number(e.target.value))}
        >
          {size === null && <option value="" disabled />}
          {sizes.map((pt) => (
            <option key={pt} value={String(pt)}>{pt}</option>
          ))}
        </select>
      </SelectChip>
      <Sep />
      {MARKS.map((b) => (
        <button
          key={b.name}
          type="button"
          className={btnClass}
          title={b.title}
          aria-label={b.title}
          aria-pressed={fmt[b.name]}
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
        aria-pressed={fmt.list === "ordered"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commands.toggleList("ordered")}
      >
        <NumberedListIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
