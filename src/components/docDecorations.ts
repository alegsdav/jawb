import type { Node as PMNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { BulletFeedback, Rating } from "@/lib/analysis";
import { PLACEHOLDER_RE } from "@/lib/facts";
import type { LineKind } from "@/lib/docLineTypes";
import { partRanges } from "@/lib/pmSchema";

/**
 * ProseMirror decorations for the resume editor: the AI's highlights drawn over the text (rating tints,
 * placeholder marks, the rating dot, the "changed vs master" bar) and the grey placeholder text of empty
 * parts. Formatting (bold, italic, size, alignment) is real document data, not decorations. Pure: runs in
 * Node, DOM is only touched inside widget toDOM.
 */

export type DecorationOptions = {
  feedback?: Record<string, BulletFeedback>;
  showHighlights: boolean;
  baseline?: Map<string, string> | null;
  showChanges: boolean;
  /** After Applied: no placeholder tint/marks. */
  quiet: boolean;
  /** Index of the line with the caret (placeholders for empty parts show only on this line); -1 for none. */
  caretLine: number;
};

export const RATING: Record<Rating, { label: string; tint: string; dot: string; text: string; light: string }> = {
  strong: { label: "Strong", tint: "bg-[#e9f6ee]", dot: "bg-[#1f8a4c]", text: "text-[#5fd08a]", light: "text-[#188038]" },
  ok: { label: "Okay", tint: "bg-[#fdf5e2]", dot: "bg-[#c98a12]", text: "text-[#f0b84a]", light: "text-[#b06000]" },
  weak: { label: "Weak", tint: "bg-[#fdecec]", dot: "bg-[#c53030]", text: "text-[#ff8a8a]", light: "text-[#d93025]" },
};

export type BulletInfo = {
  view?: BulletFeedback;            // feedback?.[bid]
  fb: BulletFeedback | null;        // view when view.state === "current", else null
  original?: string;                // baseline?.get(bid)
  isNew: boolean;                   // !!baseline && original === undefined
  changed: boolean;                 // !!baseline && original !== undefined && original !== text
  suggestion: string;               // fb?.suggestion ?? ""
  placeholders: { text: string; start: number }[]; // PLACEHOLDER_RE matches in text (start = char index)
};

export function bulletInfo(bid: string, text: string, opts: Pick<DecorationOptions, "feedback" | "baseline">): BulletInfo {
  const view = opts.feedback?.[bid];
  const fb = view?.state === "current" ? view : null;
  const original = opts.baseline?.get(bid);
  const isNew = !!opts.baseline && original === undefined;
  const changed = !!opts.baseline && original !== undefined && original !== text;
  const suggestion = fb?.suggestion ?? "";
  const placeholders = [...text.matchAll(PLACEHOLDER_RE)].map((m) => ({ text: m[0], start: m.index! }));
  return { view, fb, original, isNew, changed, suggestion, placeholders };
}

export const PART_PLACEHOLDERS: Record<LineKind, [string, string?]> = {
  name: ["Your Name"],
  contact: ["City, ST • email • phone • linkedin.com/in/you"],
  heading: ["Section heading"],
  entry: ["Organization / School / Project", "Location"],
  role: ["Role / Degree", "Dates"],
  bullet: ["Accomplishment: verb + what + measurable impact"],
  text: ["Type here"],
};

function placeholderWidget(text: string) {
  return (): HTMLElement => {
    const el = document.createElement("span");
    el.className = "doc-ui doc-placeholder";
    el.setAttribute("contenteditable", "false");
    el.setAttribute("aria-hidden", "true");
    el.textContent = text;
    return el;
  };
}

export function buildDecorations(doc: PMNode, opts: DecorationOptions): DecorationSet {
  const decorations: Decoration[] = [];

  doc.forEach((node, offset, index) => {
    const kind = node.attrs.kind as LineKind;
    const contentStart = offset + 1;

    // 1. Placeholders for empty parts, on the caret line only.
    if (index === opts.caretLine) {
      const { part1, part2 } = partRanges(node);
      const ph = PART_PLACEHOLDERS[kind];
      const parts: [[number, number] | null, string | undefined][] = [[part1, ph[0]], [part2, ph[1]]];
      for (const [range, text] of parts) {
        if (!range || !text || range[0] !== range[1]) continue;
        const pos = contentStart + range[0];
        decorations.push(
          Decoration.widget(pos, placeholderWidget(text), {
            side: 1,
            key: "ph:" + text,
            ignoreSelection: true,
          }),
        );
      }
    }

    // 2. Bullets: tint, placeholder marks, rating dot, change bar.
    if (kind === "bullet" && node.attrs.bid != null) {
      const bid = node.attrs.bid as string;
      const info = bulletInfo(bid, node.textContent, opts);
      const placeholder = !opts.quiet && info.placeholders.length > 0;

      // Placeholders win over the rating tint: they must be impossible to miss before applying.
      const tint = placeholder ? "bg-[#fff6d6]" : opts.showHighlights && info.fb ? RATING[info.fb.rating].tint : "";
      if (tint) {
        decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: tint }));
      }

      if (!opts.quiet) {
        for (const p of info.placeholders) {
          decorations.push(
            Decoration.inline(contentStart + p.start, contentStart + p.start + p.text.length, { class: "doc-ph" }),
          );
        }
      }

      if (opts.showHighlights && info.view && info.view.state !== "stale") {
        const { fb, suggestion, view } = info;
        const dotClass =
          `doc-ui doc-dot absolute top-[7px] h-2 w-2 rounded-full ${fb ? RATING[fb.rating].dot : "bg-[#9a9a95]"}` +
          (suggestion ? " ring-2 ring-offset-1 ring-[#2f5bd3]/50" : "");
        const title = fb ? RATING[fb.rating].label : "Updated";
        decorations.push(
          Decoration.widget(
            contentStart,
            () => {
              const el = document.createElement("span");
              el.className = dotClass;
              el.title = title;
              el.setAttribute("aria-hidden", "true");
              el.setAttribute("contenteditable", "false");
              return el;
            },
            {
              side: -1,
              ignoreSelection: true,
              key: `dot:${bid}:${view.state}:${fb ? fb.rating : "-"}:${suggestion ? "s" : "n"}`,
            },
          ),
        );
      }

      if (opts.showChanges && (info.changed || info.isNew)) {
        const isNew = info.isNew;
        const title = isNew ? "Added in this tailored copy" : "Changed from master resume";
        decorations.push(
          Decoration.widget(
            contentStart,
            () => {
              const el = document.createElement("span");
              el.className = "doc-ui doc-changebar absolute top-[2px] bottom-[2px] w-[3px] rounded bg-[#2f5bd3]";
              el.title = title;
              el.setAttribute("aria-hidden", "true");
              el.setAttribute("contenteditable", "false");
              return el;
            },
            { side: -1, ignoreSelection: true, key: `bar:${bid}:${isNew ? "new" : "changed"}` },
          ),
        );
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}
