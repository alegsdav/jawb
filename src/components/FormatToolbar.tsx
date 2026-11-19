"use client";

import type { ComponentType } from "react";
import { FONT_CHOICES } from "@/lib/doc/fonts";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { UndoRedo } from "./DocToolbar";
import { AlignCenterIcon, AlignJustifyIcon, AlignLeftIcon, AlignRightIcon, LinkIcon, ListIcon } from "./icons";
import { FONT_SIZES, type Align, type DocCommands, type FormatState, type MarkName } from "./editorTypes";

/** Line spacing choices in the spacing menu. */
const LINE_SPACINGS = [1, 1.15, 1.5, 2];

const MARKS: { name: MarkName; title: string; glyph: string; glyphClass: string }[] = [
  { name: "bold", title: "Bold (Ctrl+B)", glyph: "B", glyphClass: "text-[14px] font-bold" },
  { name: "italic", title: "Italic (Ctrl+I)", glyph: "I", glyphClass: "font-serif text-[16px] italic" },
  { name: "underline", title: "Underline (Ctrl+U)", glyph: "U", glyphClass: "text-[14px] underline" },
];

const ALIGNS: { align: Align; title: string; Icon: ComponentType<{ className?: string }> }[] = [
  { align: "left", title: "Align left (Ctrl+Shift+L)", Icon: AlignLeftIcon },
  { align: "center", title: "Center (Ctrl+Shift+E)", Icon: AlignCenterIcon },
  { align: "right", title: "Align right (Ctrl+Shift+R)", Icon: AlignRightIcon },
  { align: "justify", title: "Justify (Ctrl+Shift+J)", Icon: AlignJustifyIcon },
];

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;

/** A toolbar button: stays enabled only with a selection; keeps the editor's focus on press. */
const btnClass = "icon-btn shrink-0 aria-pressed:bg-surface-2 aria-pressed:text-fg";
const textBtnClass = "btn btn-sm shrink-0 min-h-8 px-2 text-[13px]";

/**
 * The formatting toolbar, in Google Docs order: undo/redo, font, size, bold/italic/underline, align, lists,
 * indent, spacing, clear formatting. Wraps onto more rows on narrow screens; nothing scrolls sideways.
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
    <div role="toolbar" aria-label="Formatting" className="flex min-w-0 flex-wrap items-center gap-1">
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
      {ALIGNS.map(({ align, title, Icon }) => (
        <button
          key={align}
          type="button"
          className={btnClass}
          title={title}
          aria-label={title}
          aria-pressed={fmt.align === align}
          disabled={!on}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commands.setAlign(align)}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
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
      <Sep />
      <button
        type="button"
        className={btnClass}
        title="Decrease indent"
        aria-label="Decrease indent"
        disabled={!on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commands.outdent()}
      >
        ⇤
      </button>
      <button
        type="button"
        className={btnClass}
        title="Increase indent"
        aria-label="Increase indent"
        disabled={!on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commands.indent()}
      >
        ⇥
      </button>
      <Sep />
      <Menu label="Spacing" title="Line and paragraph spacing" buttonClassName={textBtnClass}>
        {LINE_SPACINGS.map((n) => (
          <MenuItem key={n} onSelect={() => commands.setLineHeight(n)} disabled={!on}>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="inline-block w-3">{Math.abs(fmt.lineHeight - n) < 0.01 ? "✓" : ""}</span>
              {`Line spacing ${n}`}
            </span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => commands.adjustSpaceBefore(6)} disabled={!on}>Add space before paragraph</MenuItem>
        <MenuItem onSelect={() => commands.adjustSpaceBefore(-6)} disabled={!on}>Remove space before paragraph</MenuItem>
        <MenuItem onSelect={() => commands.adjustSpaceAfter(6)} disabled={!on}>Add space after paragraph</MenuItem>
        <MenuItem onSelect={() => commands.adjustSpaceAfter(-6)} disabled={!on}>Remove space after paragraph</MenuItem>
      </Menu>
      <Sep />
      <button
        type="button"
        className={textBtnClass}
        title="Clear formatting (Ctrl/⌘+\)"
        aria-label="Clear formatting"
        disabled={!on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commands.clearFormatting()}
      >
        Clear
      </button>
    </div>
  );
}
