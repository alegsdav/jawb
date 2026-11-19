/**
 * Pasted text, .txt and .md as a resume document, kept as it is: one paragraph per line, blank lines as empty
 * paragraphs (never two in a row), "•", "-", "*", "–" or "●" followed by a space as bullets, and a literal tab or
 * a run of 3+ spaces inside a line as a tab.
 */
import { buildDoc, normalizeDoc, paragraph, type FlatEntry } from "@/lib/doc/model";
import type { DocJSON } from "@/lib/doc/types";

/** A bullet line: the glyph, one space, then the text. */
const BULLET_LINE = /^(•|●|-|\*|–) (.*)$/;

/** The line as a paragraph's inline text: 3+ spaces after its leading indent become tabs. */
function tabbed(line: string): string {
  const indent = /^ */.exec(line)?.[0] ?? "";
  return indent + line.slice(indent.length).replace(/ {3,}/g, "\t");
}

export function textToDoc(text: string): DocJSON {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const entries: FlatEntry[] = [];
  for (const raw of lines) {
    if (!raw.trim()) {
      const prev = entries[entries.length - 1];
      if (!prev || prev.node.content?.length) entries.push({ node: paragraph(""), listType: null, depth: 0, bullet: false });
      continue;
    }
    const bullet = BULLET_LINE.exec(raw);
    if (bullet) {
      entries.push({ node: paragraph(tabbed(bullet[2])), listType: "bulletList", depth: 1, bullet: true });
    } else {
      entries.push({ node: paragraph(tabbed(raw)), listType: null, depth: 0, bullet: false });
    }
  }
  return normalizeDoc(buildDoc(entries));
}
