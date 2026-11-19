import { type Command, type Extensions, Extension, Node, getSchema, markPasteRule } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Link from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import { tabGapPx } from "../docRender";
import { cssFontStack } from "./fonts";
import { normalizeHref } from "./model";
import type { DocJSON } from "./types";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      /** Space above / below, in points, on every paragraph the selection touches. null = none. */
      setSpaceBefore: (pt: number | null) => ReturnType;
      setSpaceAfter: (pt: number | null) => ReturnType;
      /** Line spacing multiplier (1, 1.15, 1.5, 2). null = default. */
      setLineHeight: (multiple: number | null) => ReturnType;
      toggleBorderBottom: () => ReturnType;
    };
    docFontFamily: {
      setFontFamily: (family: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
    };
  }
}

const ID_CHARS = 8;
const ID_RADIX = 36;

/** A short random id that is not already in `taken`. */
export function newParagraphId(taken: Set<string>): string {
  for (;;) {
    const id = Math.random().toString(ID_RADIX).slice(2, 2 + ID_CHARS).padEnd(ID_CHARS, "0");
    if (!taken.has(id)) return id;
  }
}

/**
 * The paragraphs whose id must change: missing ids, and every later occurrence of a duplicated id
 * (the first in document order keeps it). `pos` is the paragraph's document position.
 */
export function findIdFixes(doc: PMNode): { pos: number; id: string }[] {
  const existing = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "paragraph" && node.attrs.id) existing.add(node.attrs.id as string);
    return true;
  });
  const seen = new Set<string>();
  const taken = new Set(existing);
  const fixes: { pos: number; id: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return true;
    const id = node.attrs.id as string | null;
    if (id && !seen.has(id)) {
      seen.add(id);
      return true;
    }
    const fresh = newParagraphId(taken);
    taken.add(fresh);
    seen.add(fresh);
    fixes.push({ pos, id: fresh });
    return true;
  });
  return fixes;
}

/** A transaction that fills in the fixes for `state`, or null when every paragraph id is unique. */
function idFixTransaction(state: EditorState): Transaction | null {
  const fixes = findIdFixes(state.doc);
  if (!fixes.length) return null;
  const tr = state.tr;
  for (const { pos, id } of fixes) {
    const node = tr.doc.nodeAt(pos);
    if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
  }
  return tr;
}

const idKey = new PluginKey("paragraphIds");

const ParagraphFormat = Extension.create({
  name: "paragraphFormat",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          id: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-id") || null,
            renderHTML: (attrs: { id?: string | null }) => (attrs.id ? { "data-id": attrs.id } : {}),
          },
          spaceBefore: {
            default: null,
            parseHTML: (element: HTMLElement) => ptFromStyle(element.style.marginTop),
            renderHTML: (attrs: { spaceBefore?: number | null }) =>
              attrs.spaceBefore == null ? {} : { style: `margin-top: ${attrs.spaceBefore}pt` },
          },
          spaceAfter: {
            default: null,
            parseHTML: (element: HTMLElement) => ptFromStyle(element.style.marginBottom),
            renderHTML: (attrs: { spaceAfter?: number | null }) =>
              attrs.spaceAfter == null ? {} : { style: `margin-bottom: ${attrs.spaceAfter}pt` },
          },
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => numberFrom(element.style.lineHeight),
            renderHTML: (attrs: { lineHeight?: number | null }) =>
              attrs.lineHeight == null ? {} : { style: `line-height: ${attrs.lineHeight}` },
          },
          borderBottom: {
            default: null,
            parseHTML: (element: HTMLElement) => (element.style.borderBottom ? true : null),
            renderHTML: (attrs: { borderBottom?: boolean | null }) =>
              attrs.borderBottom ? { style: "border-bottom: 1px solid currentColor; padding-bottom: 1px" } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setSpaceBefore: (pt) => setParagraphAttrs({ spaceBefore: pt }),
      setSpaceAfter: (pt) => setParagraphAttrs({ spaceAfter: pt }),
      setLineHeight: (multiple) => setParagraphAttrs({ lineHeight: multiple }),
      toggleBorderBottom: () => toggleParagraphBorder(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: idKey,
        // Enter copies attrs and paste can carry data-id, so fix duplicates and gaps after every edit.
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          return idFixTransaction(newState);
        },
        // Documents loaded without ids get them on the first tick after the editor mounts.
        view(view: EditorView) {
          queueMicrotask(() => {
            if (view.isDestroyed) return;
            const tr = idFixTransaction(view.state);
            if (tr) view.dispatch(tr);
          });
          return {};
        },
      }),
    ];
  },
});

/** Sets the given attributes on every paragraph the selection touches. */
function setParagraphAttrs(attrs: Record<string, unknown>): Command {
  return ({ tr }) => {
    const { from, to } = tr.selection;
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === "paragraph") tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
      return true;
    });
    return true;
  };
}

/** Adds the bottom rule to the selected paragraphs, or removes it when they all have one. */
function toggleParagraphBorder(): Command {
  return (props) => {
    const { from, to } = props.tr.selection;
    let any = false;
    let all = true;
    props.tr.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === "paragraph") {
        any = true;
        if (!node.attrs.borderBottom) all = false;
      }
      return true;
    });
    return setParagraphAttrs({ borderBottom: any && all ? null : true })(props);
  };
}

function numberFrom(value: string | null | undefined): number | null {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : null;
}

/** Reads a margin in points; px (from pasted HTML) is converted at 0.75pt per px. */
function ptFromStyle(value: string | null | undefined): number | null {
  const n = numberFrom(value);
  if (n === null) return null;
  return value?.endsWith("px") ? Math.round(n * 0.75 * 10) / 10 : n;
}

/** The plain family name from a CSS font-family value, e.g. `"Times New Roman", Times, serif` -> Times New Roman. */
function familyFromStyle(value: string | null | undefined): string | null {
  const first = value?.split(",")[0]?.trim().replace(/^["']|["']$/g, "").trim();
  return first || null;
}

/** Font family on the textStyle mark, stored as the plain name and rendered with the fallback stack. */
const DocFontFamily = Extension.create({
  name: "docFontFamily",

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element: HTMLElement) => familyFromStyle(element.style.fontFamily),
            renderHTML: (attrs: { fontFamily?: string | null }) =>
              attrs.fontFamily ? { style: `font-family: ${cssFontStack(attrs.fontFamily)}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontFamily: (family) => ({ chain }) => chain().setMark("textStyle", { fontFamily: family }).run(),
      unsetFontFamily: () => ({ chain }) =>
        chain().setMark("textStyle", { fontFamily: null }).removeEmptyTextStyle().run(),
    };
  },
});

/** The narrowest a right-aligned tab may be (px). */
const MIN_TAB_PX = 8;

/**
 * The width (in the page's own, unscaled px) a tab needs so what follows it ends at the content's right edge.
 * `scale` is how much the page is zoomed on screen: getBoundingClientRect reports scaled sizes under a CSS
 * transform (ZoomFrame), while an inline width is in unscaled px, so every measured distance is divided by it.
 * A right part that does not fit on the line (`wraps`) leaves the tab at its minimum.
 */
export function tabWidth(m: { contentRight: number; tabLeft: number; afterWidth: number; scale: number; wraps: boolean }): number {
  if (m.wraps) return MIN_TAB_PX;
  const free = (m.contentRight - m.tabLeft - m.afterWidth) / (m.scale > 0 ? m.scale : 1);
  // Rounded down with 1px to spare: a width a fraction too wide would wrap the right part onto its own line.
  return Math.max(MIN_TAB_PX, Math.floor(free) - 1);
}

function layoutTabs(root: HTMLElement): void {
  const paragraphs = new Set<HTMLElement>();
  for (const tab of Array.from(root.querySelectorAll<HTMLElement>("span.doc-tab"))) {
    const paragraph = tab.closest("p");
    if (paragraph) paragraphs.add(paragraph);
  }
  for (const paragraph of paragraphs) {
    const tabs = Array.from(paragraph.querySelectorAll<HTMLElement>("span.doc-tab"));
    // The LAST tab is the right-aligned one: it stretches so what follows ends at the margin. A tab before it
    // (Tab pressed at the start of a line, or twice) is an ordinary indent to the next 0.5in stop, as in Docs.
    const tab = tabs[tabs.length - 1];
    // A paragraph inside a list item is inline: its box is its text, so the line's edge is the item's.
    const lineStyle = getComputedStyle(paragraph);
    const lineBlock = lineStyle.display === "inline" && paragraph.parentElement ? paragraph.parentElement : paragraph;
    const lineBox = lineBlock.getBoundingClientRect();
    const lineScale = lineBlock.offsetWidth > 0 ? lineBox.width / lineBlock.offsetWidth : 1;
    const contentLeft = lineBox.left + parseFloat(getComputedStyle(lineBlock).paddingLeft || "0") * lineScale;
    for (const t of tabs) {
      t.style.display = "inline-block";
      t.style.width = "0px";
    }
    for (const t of tabs) {
      if (t === tab) break;
      t.style.width = `${tabGapPx((t.getBoundingClientRect().left - contentLeft) / lineScale)}px`;
    }
    const box = lineBox;
    const scale = lineScale;
    const contentRight = box.right - parseFloat(getComputedStyle(lineBlock).paddingRight || "0") * scale;
    const tabLeft = tab.getBoundingClientRect().left;

    const after = document.createRange();
    after.setStartAfter(tab);
    after.setEnd(paragraph, paragraph.childNodes.length);
    const rects = Array.from(after.getClientRects()).filter((r) => r.width > 0);
    // A styled run reports both its element box and its text box on the same line, so count lines, not rects.
    const wraps = new Set(rects.map((r) => Math.round(r.top / scale))).size > 1;
    const afterWidth = rects.length ? after.getBoundingClientRect().width : 0;
    tab.style.width = `${tabWidth({ contentRight, tabLeft, afterWidth, scale, wraps })}px`;
  }
}

/** A right-aligned tab stop, stored as the node { type: "tab" }. */
export const Tab = Node.create({
  name: "tab",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  // Above the list item keymap, so Tab in a list sinks the item instead of inserting a tab.
  priority: 1000,

  parseHTML() {
    return [{ tag: "span[data-tab]" }];
  },

  renderHTML() {
    return ["span", { class: "doc-tab", "data-tab": "", contenteditable: "false" }];
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive("listItem")) {
          this.editor.commands.sinkListItem("listItem");
        } else {
          this.editor.commands.insertContent({ type: this.name });
        }
        return true; // never move focus out of the editor
      },
      "Shift-Tab": () => {
        if (this.editor.isActive("listItem")) this.editor.commands.liftListItem("listItem");
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("docTabLayout"),
        view(view: EditorView) {
          if (typeof window === "undefined") return {};
          const relayout = () => layoutTabs(view.dom as HTMLElement);
          relayout();
          // The text's width changes without any edit when the window or page is resized, the margins change
          // (the editor's own size changes), or a font finishes loading (bold and italic faces load when first
          // used, after the first layout). Zoom needs nothing: widths are kept in the page's unscaled px.
          window.addEventListener("resize", relayout);
          const fonts = document.fonts;
          fonts?.addEventListener?.("loadingdone", relayout);
          void fonts?.ready.then(relayout);
          const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(relayout);
          observer?.observe(view.dom);
          return {
            update: relayout,
            destroy: () => {
              window.removeEventListener("resize", relayout);
              fonts?.removeEventListener?.("loadingdone", relayout);
              observer?.disconnect();
            },
          };
        },
      }),
    ];
  },
});

/**
 * What typed or pasted text links: an address with a scheme (http, https, mailto), a www. host, or an email. A bare
 * domain ("example.com") stays text, since ordinary words such as "Node.js" look like one.
 */
export function isLinkable(text: string): boolean {
  return /^(?:https?:\/\/|www\.|mailto:)/i.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

/** The href a linkable text links to (www. gets https://, an email mailto:), or null when it is not one. */
export function linkTargetOf(text: string): string | null {
  if (!isLinkable(text)) return null;
  return normalizeHref(/^[^\s:]+@/.test(text) && !/^https?:|^www\./i.test(text) ? `mailto:${text}` : text);
}

/** Addresses inside pasted text: a scheme or www. address, or an email; trailing punctuation is not part of them. */
const PASTED_LINK = /(?:https?:\/\/|www\.|[^\s@<>"']+@)[^\s<>"']*[^\s<>"'.,;:!?)\]]/gi;

/**
 * The link extension. Its own paste rule builds http:// links for bare www. text; this one builds https:// (see
 * linkTargetOf), and only for linkable text, so the same rule holds for typing, pasting and the link box.
 */
const DocLink = Link.extend({
  addPasteRules() {
    return [
      markPasteRule({
        find: PASTED_LINK,
        type: this.type,
        getAttributes: (match) => {
          const href = linkTargetOf(match[0]);
          return href ? { href } : null;
        },
      }),
    ];
  },
});

export const docExtensions: Extensions = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    strike: false,
    // A horizontal line is an empty paragraph with a bottom border (see DocJSON in ./types), not a rule node.
    horizontalRule: false,
    // Off so the JSON is exactly what the user wrote, not an extra empty paragraph at the end.
    trailingNode: false,
    link: false,
  }),
  // A link is a mark with only an href in the JSON (see DocMark). Target and rel are set on render only; the
  // editor's JSON carries their defaults too, which normalizeDoc drops. Only http(s) and mailto are allowed.
  DocLink.configure({
    openOnClick: false,
    autolink: true,
    linkOnPaste: true,
    defaultProtocol: "https",
    protocols: [],
    shouldAutoLink: isLinkable,
    isAllowedUri: (url: string) => normalizeHref(url) !== null,
    HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
  }),
  TextStyle,
  FontSize,
  DocFontFamily,
  TextAlign.configure({ types: ["paragraph"] }),
  ParagraphFormat,
  Tab,
];

export const docSchema = getSchema(docExtensions);

/** True when the JSON is a valid document for docSchema. */
export function isValidDoc(json: unknown): boolean {
  try {
    const node = docSchema.nodeFromJSON(json);
    node.check();
    return node.type.name === "doc";
  } catch {
    return false;
  }
}

/** The ProseMirror document for a DocJSON. Throws when it is not valid. */
export function docFromJSON(json: DocJSON): PMNode {
  const node = docSchema.nodeFromJSON(json);
  node.check();
  return node;
}
