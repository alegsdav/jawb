/**
 * Plain text of a resume document, for sending it to the AI rebuild (the clean template). Pure: no DOM, no React.
 */
import { flattenDoc } from "./doc/model";
import type { DocInline, DocJSON, DocMark, DocParagraph } from "./doc/types";

/** The address a text run links to, or undefined. */
function linkOf(n: DocInline): string | undefined {
  if (n.type !== "text") return undefined;
  return n.marks?.find((m): m is Extract<DocMark, { type: "link" }> => m.type === "link")?.attrs.href;
}

/** An address without its scheme and trailing slash, to compare it with the text a link shows. */
const bare = (s: string): string => s.replace(/^(https?:\/\/|mailto:)/i, "").replace(/\/$/, "").toLowerCase();

/**
 * A link's text, with its address after it in brackets when the text is not the address itself, so the AI still
 * gets "LinkedIn (https://www.linkedin.com/in/x)" and the address survives the rebuild.
 */
function linkedText(text: string, href: string): string {
  return bare(text) === bare(href) ? text : `${text} (${href})`;
}

/**
 * A paragraph's text with its links written out. Runs of one link are joined first, so a link with bold in it is
 * still one link. Tabs and hard breaks are kept for the caller to render.
 */
function paragraphPlainText(p: DocParagraph): string {
  const runs: { text: string; href?: string }[] = [];
  for (const n of p.content ?? []) {
    const text = n.type === "text" ? n.text : n.type === "tab" ? "\t" : "\n";
    const href = linkOf(n);
    const last = runs[runs.length - 1];
    if (last && last.href === href) last.text += text;
    else runs.push({ text, href });
  }
  return runs.map((r) => (r.href ? linkedText(r.text, r.href) : r.text)).join("");
}

/**
 * One line per paragraph, in document order. List items start with "• " (continuation paragraphs of an item are
 * indented to line up), each extra list depth indents two spaces, a tab becomes " — " so "Company<tab>Dates" reads
 * as one line, and a hard break stays a newline. Links keep their address (see linkedText). Undefined (no document
 * yet) gives "".
 */
export function resumePlainText(doc: DocJSON | undefined): string {
  if (!doc) return "";
  return flattenDoc(doc)
    .map((p) => {
      const body = paragraphPlainText(p.node).replace(/\t/g, " — ");
      if (!p.listType) return body;
      const indent = "  ".repeat(Math.max(0, p.depth - 1));
      return indent + (p.bullet ? "• " : "  ") + body;
    })
    .join("\n")
    .trim();
}
