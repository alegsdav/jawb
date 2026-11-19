import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { BulletFeedback, Rating } from "@/lib/analysis";
import { RATING, bulletInfo } from "./docDecorations";

/**
 * The AI's highlights drawn over the resume document, as ProseMirror decorations (never document data):
 * the rating tint and dot for each rated paragraph, the [placeholder] marks, and the "changed vs master" bar.
 */

export type HighlightOptions = {
  feedback?: Record<string, BulletFeedback>;   // keyed by paragraph id (= derived bullet id)
  showHighlights: boolean;
  baseline?: Map<string, string> | null;        // paragraph id → text in the master at copy time
  showChanges: boolean;
  quiet: boolean;                               // after Applied: no placeholder tint
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    aiHighlights: {
      /** Replaces the highlight options and redraws the decorations. Not an undoable edit. */
      setHighlightOptions: (opts: HighlightOptions) => ReturnType;
    };
  }
}

type HighlightState = { opts: HighlightOptions; decorations: DecorationSet };

const NO_HIGHLIGHTS: HighlightOptions = { showHighlights: false, showChanges: false, quiet: false };
const highlightKey = new PluginKey<HighlightState>("aiHighlights");

/** Options that draw the same highlights (the page may pass equal objects that are not the same object). */
export function sameOptions(a: HighlightOptions, b: HighlightOptions): boolean {
  return a.showHighlights === b.showHighlights && a.showChanges === b.showChanges && a.quiet === b.quiet
    && JSON.stringify(a.feedback ?? null) === JSON.stringify(b.feedback ?? null)
    && JSON.stringify([...(a.baseline ?? [])]) === JSON.stringify([...(b.baseline ?? [])]);
}

const LEAF_TEXT: Record<string, string> = { tab: "\t", hardBreak: "\n" };

/** A paragraph's text with the same characters as paragraphText in src/lib/doc/model.ts (tab "\t", break "\n"). */
export function paragraphPlainText(node: PMNode): string {
  return node.textBetween(0, node.content.size, undefined, (leaf) => LEAF_TEXT[leaf.type.name] ?? "");
}

/** How a paragraph differs from the master copy: new (non-empty, not in the master) or changed. */
function changeKind(id: string, text: string, baseline: Map<string, string>): "new" | "changed" | null {
  const original = baseline.get(id);
  if (original === undefined) return text ? "new" : null;
  return original !== text ? "changed" : null;
}

/** The small dot at the end of a rated paragraph. Grey "Updated" when the rating no longer applies. */
function ratingDot(rating: Rating | null, suggested: boolean): () => HTMLElement {
  const className =
    `doc-ui doc-dot absolute top-[7px] h-2 w-2 rounded-full ${rating ? RATING[rating].dot : "bg-[#9a9a95]"}` +
    (suggested ? " ring-2 ring-offset-1 ring-[#2f5bd3]/50" : "");
  const title = rating ? RATING[rating].label : "Updated";
  return () => {
    const el = document.createElement("span");
    el.className = className;
    el.title = title;
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("contenteditable", "false");
    return el;
  };
}

/** The decorations for one paragraph; `pos` is its position in the document. */
function paragraphDecorations(node: PMNode, pos: number, opts: HighlightOptions): Decoration[] {
  const out: Decoration[] = [];
  const from = pos + 1;
  const to = from + node.content.size;
  const id = (node.attrs.id as string | null) ?? "";
  const text = paragraphPlainText(node);
  const info = bulletInfo(id, text, opts);

  // Placeholders win over the rating tint: they must be impossible to miss before applying.
  const placeholder = !opts.quiet && info.placeholders.length > 0;
  if (placeholder) {
    out.push(Decoration.node(pos, pos + node.nodeSize, { class: "bg-[#fff6d6]" }));
    for (const p of info.placeholders) {
      out.push(Decoration.inline(from + p.start, from + p.start + p.text.length, { class: "doc-ph" }));
    }
  } else if (opts.showHighlights && info.fb && from < to) {
    out.push(Decoration.inline(from, to, { class: RATING[info.fb.rating].tint }));
  }

  if (opts.showHighlights && info.view && info.view.state !== "stale") {
    const rating = info.fb?.rating ?? null;
    const suggested = info.suggestion !== "";
    out.push(
      Decoration.widget(to, ratingDot(rating, suggested), {
        side: 1,
        ignoreSelection: true,
        key: `dot:${id}:${info.view.state}:${rating ?? "-"}:${suggested ? "s" : "n"}`,
      }),
    );
  }

  const change = opts.showChanges && opts.baseline ? changeKind(id, text, opts.baseline) : null;
  if (change) {
    const title = change === "new" ? "Added in this tailored copy" : "Changed from master resume";
    out.push(Decoration.node(pos, pos + node.nodeSize, { class: "doc-changed", title, "data-change": change }));
  }
  return out;
}

/** All highlight decorations for `doc`. Pure: no DOM, and the document itself is not changed. */
export function buildHighlights(doc: PMNode, opts: HighlightOptions): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return true;
    decorations.push(...paragraphDecorations(node, pos, opts));
    return false; // paragraphs hold only inline content
  });
  return DecorationSet.create(doc, decorations);
}

function freshState(state: EditorState): HighlightState {
  return { opts: NO_HIGHLIGHTS, decorations: buildHighlights(state.doc, NO_HIGHLIGHTS) };
}

export const AiHighlights = Extension.create({
  name: "aiHighlights",

  addCommands() {
    return {
      setHighlightOptions:
        (opts) =>
        ({ tr, state }) => {
          // Same options: nothing to change (callers should skip the call: TipTap dispatches the transaction anyway).
          const cur = highlightKey.getState(state)?.opts;
          if (cur && sameOptions(cur, opts)) return false;
          tr.setMeta(highlightKey, opts).setMeta("addToHistory", false);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: highlightKey,
        state: {
          init: (_config, state) => freshState(state),
          apply(tr, prev, _oldState, next) {
            const opts = tr.getMeta(highlightKey) as HighlightOptions | undefined;
            if (!opts && !tr.docChanged) return prev;
            const current = opts ?? prev.opts;
            return { opts: current, decorations: buildHighlights(next.doc, current) };
          },
        },
        props: {
          decorations: (state) => highlightKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
