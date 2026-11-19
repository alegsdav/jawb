/**
 * Plain text of a resume document, for sending it to the AI rebuild (the clean template). Pure: no DOM, no React.
 */
import { flattenDoc } from "./doc/model";
import type { DocJSON } from "./doc/types";

/**
 * One line per paragraph, in document order. List items start with "• " (continuation paragraphs of an item are
 * indented to line up), each extra list depth indents two spaces, a tab becomes " — " so "Company<tab>Dates" reads
 * as one line, and a hard break stays a newline. Undefined (no document yet) gives "".
 */
export function resumePlainText(doc: DocJSON | undefined): string {
  if (!doc) return "";
  return flattenDoc(doc)
    .map((p) => {
      const body = p.text.replace(/\t/g, " — ");
      if (!p.listType) return body;
      const indent = "  ".repeat(Math.max(0, p.depth - 1));
      return indent + (p.bullet ? "• " : "  ") + body;
    })
    .join("\n")
    .trim();
}
