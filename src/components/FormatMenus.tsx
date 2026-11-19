"use client";

import type { RefObject } from "react";
import { MenuItem, MenuSeparator } from "./Menu";
import { MenuBarMenu, docEdit } from "./DocToolbar";
import type { Align, DocCommands, FormatState } from "./editorTypes";

/** Sizes in the Format menu (the toolbar keeps the full list). */
const MENU_SIZES = [8, 10, 11, 12, 14, 16, 18, 24];
const ALIGN_CHOICES: { align: Align; label: string; shortcut: string }[] = [
  { align: "left", label: "Align left", shortcut: "Ctrl+Shift+L" },
  { align: "center", label: "Center", shortcut: "Ctrl+Shift+E" },
  { align: "right", label: "Align right", shortcut: "Ctrl+Shift+R" },
  { align: "justify", label: "Justify", shortcut: "Ctrl+Shift+J" },
];
const LINE_SPACINGS = [1, 1.15, 1.5, 2];

/** A menu row with a check mark when `on`. */
function Tick({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="inline-block w-3">{on ? "✓" : ""}</span>
      {children}
      {on && <span className="sr-only">(on)</span>}
    </span>
  );
}

type MenuProps = { commandsRef: RefObject<DocCommands | null>; fmt: FormatState };

/** Format menu: text style, size, alignment, lists, spacing, rule, clear. Kept short; the popup scrolls. */
export function FormatMenu({ commandsRef, fmt }: MenuProps) {
  const run = (f: (c: DocCommands) => void) => () => {
    if (commandsRef.current) f(commandsRef.current);
  };
  const off = !fmt.active;
  return (
    <MenuBarMenu label="Format">
      <MenuItem onSelect={run((c) => c.toggleMark("bold"))} disabled={off} shortcut="Ctrl+B">
        <Tick on={fmt.bold}>Bold</Tick>
      </MenuItem>
      <MenuItem onSelect={run((c) => c.toggleMark("italic"))} disabled={off} shortcut="Ctrl+I">
        <Tick on={fmt.italic}>Italic</Tick>
      </MenuItem>
      <MenuItem onSelect={run((c) => c.toggleMark("underline"))} disabled={off} shortcut="Ctrl+U">
        <Tick on={fmt.underline}>Underline</Tick>
      </MenuItem>
      <MenuSeparator />
      <div className="float-muted px-2 pt-1 text-[11px]">Text size</div>
      {MENU_SIZES.map((pt) => (
        <MenuItem key={pt} onSelect={run((c) => c.setSize(pt))} disabled={off}>
          <Tick on={fmt.fontSize === pt}>{`${pt} pt`}</Tick>
        </MenuItem>
      ))}
      <MenuSeparator />
      {ALIGN_CHOICES.map(({ align, label, shortcut }) => (
        <MenuItem key={align} onSelect={run((c) => c.setAlign(align))} disabled={off} shortcut={shortcut}>
          <Tick on={fmt.align === align}>{label}</Tick>
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem onSelect={run((c) => c.toggleList("bullet"))} disabled={off}>
        <Tick on={fmt.list === "bullet"}>Bulleted list</Tick>
      </MenuItem>
      <MenuItem onSelect={run((c) => c.toggleList("ordered"))} disabled={off}>
        <Tick on={fmt.list === "ordered"}>Numbered list</Tick>
      </MenuItem>
      <MenuSeparator />
      <div className="float-muted px-2 pt-1 text-[11px]">Line spacing</div>
      {LINE_SPACINGS.map((n) => (
        <MenuItem key={n} onSelect={run((c) => c.setLineHeight(n))} disabled={off}>
          <Tick on={Math.abs(fmt.lineHeight - n) < 0.01}>{String(n)}</Tick>
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem onSelect={run((c) => c.toggleBorderBottom())} disabled={off}>
        <Tick on={fmt.borderBottom}>Paragraph border below</Tick>
      </MenuItem>
      <MenuItem onSelect={run((c) => c.insertHorizontalLine())} disabled={off}>Horizontal line</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={run((c) => c.clearFormatting())} disabled={off} shortcut="Ctrl+\">
        Clear formatting
      </MenuItem>
    </MenuBarMenu>
  );
}

/** Edit menu: undo and redo (the editor's own history), then the clipboard actions. */
export function EditMenu({ commandsRef, fmt }: MenuProps) {
  const off = !fmt.active;
  return (
    <MenuBarMenu label="Edit">
      <MenuItem onSelect={() => commandsRef.current?.undo()} disabled={!fmt.canUndo} shortcut="Ctrl+Z">Undo</MenuItem>
      <MenuItem onSelect={() => commandsRef.current?.redo()} disabled={!fmt.canRedo} shortcut="Ctrl+Shift+Z">Redo</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => void docEdit("cut")} disabled={off} shortcut="Ctrl+X">Cut</MenuItem>
      <MenuItem onSelect={() => void docEdit("copy")} disabled={off} shortcut="Ctrl+C">Copy</MenuItem>
      <MenuItem onSelect={() => void docEdit("paste")} disabled={off} shortcut="Ctrl+V">Paste</MenuItem>
      <MenuItem onSelect={() => void docEdit("selectAll")} disabled={off} shortcut="Ctrl+A">Select all</MenuItem>
    </MenuBarMenu>
  );
}
