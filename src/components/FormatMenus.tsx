"use client";

import { useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MenuItem, MenuSeparator } from "./Menu";
import { MenuBarMenu, docEdit } from "./DocToolbar";
import { TabStopsDialog } from "./TabStopsDialog";
import type { Align, DocCommands, FormatState } from "./editorTypes";

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
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden="true" className="inline-block w-3">{on ? "✓" : ""}</span>
      {children}
      {on && <span className="sr-only">(on)</span>}
    </span>
  );
}

type MenuProps = { commandsRef: RefObject<DocCommands | null>; fmt: FormatState };

/**
 * Format menu: alignment, indent, spacing, tab stops, rule, clear. Bold, italic, underline, link, size and lists are
 * on the toolbar (their shortcuts still work), so they are not repeated here. The tab stops dialog lives here,
 * outside the menu, so it stays open after the menu closes on pick.
 */
export function FormatMenu({ commandsRef, fmt }: MenuProps) {
  const [tabsOpen, setTabsOpen] = useState(false);
  const run = (f: (c: DocCommands) => void) => () => {
    if (commandsRef.current) f(commandsRef.current);
  };
  const off = !fmt.active;
  return (
    <>
      <MenuBarMenu label="Format">
        {ALIGN_CHOICES.map(({ align, label, shortcut }) => (
          <MenuItem key={align} onSelect={run((c) => c.setAlign(align))} disabled={off} shortcut={shortcut}>
            <Tick on={fmt.align === align}>{label}</Tick>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={run((c) => c.outdent())} disabled={off}><Tick on={false}>Decrease indent</Tick></MenuItem>
        <MenuItem onSelect={run((c) => c.indent())} disabled={off}><Tick on={false}>Increase indent</Tick></MenuItem>
        <MenuSeparator />
        {/* pl-7: the item's px-2 plus the Tick column (w-3) and gap (gap-2), so the caption lines up with the labels. */}
        <div className="float-muted pl-7 pr-2 pt-1 text-[11px]">Line spacing</div>
        {LINE_SPACINGS.map((n) => (
          <MenuItem key={n} onSelect={run((c) => c.setLineHeight(n))} disabled={off}>
            <Tick on={Math.abs(fmt.lineHeight - n) < 0.01}>{String(n)}</Tick>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={run((c) => c.adjustSpaceBefore(6))} disabled={off}>
          <Tick on={false}>Add space before paragraph</Tick>
        </MenuItem>
        <MenuItem onSelect={run((c) => c.adjustSpaceBefore(-6))} disabled={off}>
          <Tick on={false}>Remove space before paragraph</Tick>
        </MenuItem>
        <MenuItem onSelect={run((c) => c.adjustSpaceAfter(6))} disabled={off}>
          <Tick on={false}>Add space after paragraph</Tick>
        </MenuItem>
        <MenuItem onSelect={run((c) => c.adjustSpaceAfter(-6))} disabled={off}>
          <Tick on={false}>Remove space after paragraph</Tick>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => setTabsOpen(true)} disabled={off}>
          <Tick on={false}>Tab stops…</Tick>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={run((c) => c.toggleBorderBottom())} disabled={off}>
          <Tick on={fmt.borderBottom}>Paragraph border below</Tick>
        </MenuItem>
        <MenuItem onSelect={run((c) => c.insertHorizontalLine())} disabled={off}>
          <Tick on={false}>Horizontal line</Tick>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={run((c) => c.clearFormatting())} disabled={off} shortcut="Ctrl+\">
          <Tick on={false}>Clear formatting</Tick>
        </MenuItem>
      </MenuBarMenu>
      {tabsOpen &&
        createPortal(
          <TabStopsDialog
            stops={fmt.tabStops}
            onApply={(stops) => commandsRef.current?.setTabStops(stops)}
            onClose={() => setTabsOpen(false)}
          />,
          document.body,
        )}
    </>
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
