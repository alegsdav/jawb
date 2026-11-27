import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { BulletFeedback } from "@/lib/analysis";
import { RATING, bulletInfo } from "./docDecorations";

/**
 * The AI's highlights drawn over the resume document, as ProseMirror decorations (never document data):
 * the rating tint for each rated paragraph, the [placeholder] marks and the navy outline around the paragraph
 * the coaching panel is on. (Bullets that differ from the master are not marked here: selecting one offers
 * "Revert to master" in its card.)
 */

export type HighlightOptions = {
  feedback?: Record<string, BulletFeedback>;   // keyed by paragraph id (= derived bullet id)
  showHighlights: boolean;
  baseline?: Map<string, string> | null;        // paragraph id → text in the master at copy time
  /** Whether "Revert to master" is offered for bullets that differ from the master. Draws nothing itself. */
  showChanges: boolean;
  quiet: boolean;                               // after Applied: no placeholder tint
  /** The paragraph the coaching panel is on: drawn with a navy outline (class doc-focus). Not document data. */
  focusId?: string | null;
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
    && (a.focusId ?? null) === (b.focusId ?? null)
    && JSON.stringify(a.feedback ?? null) === JSON.stringify(b.feedback ?? null)
    && JSON.stringify([...(a.baseline ?? [])]) === JSON.stringify([...(b.baseline ?? [])]);
}

const LEAF_TEXT: Record<string, string> = { tab: "\t", hardBreak: "\n" };

/** A paragraph's text with the same characters as paragraphText in src/lib/doc/model.ts (tab "\t", break "\n"). */
export function paragraphPlainText(node: PMNode): string {
  return node.textBetween(0, node.content.size, undefined, (leaf) => LEAF_TEXT[leaf.type.name] ?? "");
}

/** The decorations for one paragraph; `pos` is its position in the document. */
function paragraphDecorations(node: PMNode, pos: number, opts: HighlightOptions): Decoration[] {
  const out: Decoration[] = [];
  const from = pos + 1;
  const to = from + node.content.size;
  const id = (node.attrs.id as string | null) ?? "";
  const text = paragraphPlainText(node);
  const info = bulletInfo(id, text, opts);

  if (opts.focusId && id === opts.focusId) {
    out.push(Decoration.node(pos, pos + node.nodeSize, { class: "doc-focus" }));
  }

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
