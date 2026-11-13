import type { Bullet, Item, Resume, Section } from "./types";
import { addFacts } from "./facts";

export const uid = () => Math.random().toString(36).slice(2, 10);

export const emptyItem = (): Item => ({
  id: uid(), title: "", subtitle: "", location: "", dates: "", bullets: [{ id: uid(), text: "" }],
});

export const emptySection = (title = "Section"): Section => ({
  id: uid(), title, items: [emptyItem()],
});

export const RESUME_VERSION = 2;

export const emptyResume = (): Resume => ({
  version: RESUME_VERSION,
  header: { name: "", contact: "" },
  sections: [],
});

export function isEmptyResume(r: Resume): boolean {
  return !r.sections.some((s) => s.items.some((it) => it.title || it.subtitle || it.bullets.some((b) => b.text.trim())));
}

/** Make sure every section/item/bullet has an id (AI output or old data may lack them). */
export function normalizeResume(raw: unknown): Resume {
  const r = (raw ?? {}) as Partial<Resume>;
  const legacy = (r.version ?? 1) < RESUME_VERSION;
  return {
    version: RESUME_VERSION,
    header: {
      name: r.header?.name ?? "",
      contact: r.header?.contact ?? "",
    },
    ...(Array.isArray(r.facts) ? { facts: r.facts.filter((f): f is string => typeof f === "string") } : {}),
    sections: (r.sections ?? []).map((s) => ({
      id: s.id || uid(),
      title: s.title ?? "",
      items: (s.items ?? []).map((it) => {
        const title = it.title ?? "";
        const subtitle = it.subtitle ?? "";
        // v1 stored role in title and organization in subtitle; Harvard puts the organization first.
        const swap = legacy && Boolean(it.dates || it.location) && Boolean(subtitle);
        return {
          id: it.id || uid(),
          title: swap ? subtitle : title,
          subtitle: swap ? title : subtitle,
          location: it.location ?? "",
          dates: it.dates ?? "",
          bullets: (it.bullets ?? []).map((b) =>
            typeof b === "string" ? { id: uid(), text: b } : { id: b.id || uid(), text: b.text ?? "" },
          ),
        };
      }),
    })),
  };
}

/** True when an item renders as a single inline line (skills, publications, memberships). */
export const isInlineItem = (it: Item) => !it.bullets.length && !it.dates && !it.location;

/** Plain-text rendering with bullet ids, used in AI prompts. */
export function resumeToPromptText(r: Resume): string {
  const lines = [r.header.name, r.header.contact, ""];
  for (const s of r.sections) {
    lines.push(`## ${s.title}`);
    for (const it of s.items) {
      const head = [it.title, it.subtitle, it.location, it.dates].filter(Boolean).join(" | ");
      if (head) lines.push(`- ${head}`);
      for (const b of it.bullets) if (b.text.trim()) lines.push(`    [b:${b.id}] ${b.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Plain text for copy/paste into application forms. */
export function resumeToPlainText(r: Resume): string {
  return resumeToPromptText(r).replace(/\[b:[^\]]+\] /g, "• ");
}

export function replaceBullet(r: Resume, bulletId: string, text: string): Resume {
  return {
    ...r,
    sections: r.sections.map((s) => ({
      ...s,
      items: s.items.map((it) => ({
        ...it,
        bullets: it.bullets.map((b) => (b.id === bulletId ? { ...b, text } : b)),
      })),
    })),
  };
}

export function bulletTextMap(r: Resume): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of r.sections) for (const it of s.items) for (const b of it.bullets) m.set(b.id, b.text);
  return m;
}

/** Number of bullets in `r` whose text differs from the master bullet with the same id (new bullets count too). */
export function countChangedBullets(r: Resume, master: Map<string, string>): number {
  let n = 0;
  for (const [id, text] of bulletTextMap(r)) if (master.get(id) !== text) n++;
  return n;
}

const normKey = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const wordSet = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]+/g) ?? []);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** Bullet wording counts as "the same bullet, edited" at or above this word overlap. */
const SIMILAR = 0.5;

/**
 * Greedy one-to-one matching: repeatedly take the highest-scoring (next, prev) pair whose score is
 * at least `min`, skipping indexes already matched. Ties go to the earliest pair, so order breaks ties.
 */
function greedyMatch<A, B>(
  nexts: A[],
  prevs: B[],
  score: (a: A, b: B) => number,
  min: number,
  matched: Map<number, number>,
): void {
  const usedPrev = new Set(matched.values());
  const pairs: { i: number; j: number; s: number }[] = [];
  nexts.forEach((a, i) => {
    if (matched.has(i)) return;
    prevs.forEach((b, j) => {
      if (usedPrev.has(j)) return;
      const s = score(a, b);
      if (s >= min) pairs.push({ i, j, s });
    });
  });
  pairs.sort((x, y) => y.s - x.s || x.i - y.i || x.j - y.j);
  for (const { i, j } of pairs) {
    if (matched.has(i) || usedPrev.has(j)) continue;
    matched.set(i, j);
    usedPrev.add(j);
  }
}

/** Index pairs (next -> prev) of bullets that are the same bullet: identical text first, then closest wording. */
function matchBullets(next: Bullet[], prev: Bullet[]): Map<number, number> {
  const m = new Map<number, number>();
  greedyMatch(next, prev, (a, b) => (a.text.trim() && normKey(a.text) === normKey(b.text) ? 1 : 0), 1, m);
  const nw = next.map((b) => wordSet(b.text));
  const pw = prev.map((b) => wordSet(b.text));
  greedyMatch(next.map((_, i) => i), prev.map((_, j) => j), (i, j) => jaccard(nw[i], pw[j]), SIMILAR, m);
  return m;
}

/** Items match by title+subtitle, then by title, then (for renamed entries) by how many bullets they share. */
function matchItems(next: Item[], prev: Item[]): Map<number, number> {
  const m = new Map<number, number>();
  const full = (it: Item) => (it.title.trim() || it.subtitle.trim() ? `${normKey(it.title)}\u0000${normKey(it.subtitle)}` : "");
  greedyMatch(next, prev, (a, b) => (full(a) && full(a) === full(b) ? 1 : 0), 1, m);
  greedyMatch(next, prev, (a, b) => (normKey(a.title) && normKey(a.title) === normKey(b.title) ? 1 : 0), 1, m);
  greedyMatch(next, prev, (a, b) => matchBullets(a.bullets, b.bullets).size, 1, m);
  return m;
}

/** Sections match by title, then (for renamed headings) by how many items they share. */
function matchSections(next: Section[], prev: Section[]): Map<number, number> {
  const m = new Map<number, number>();
  greedyMatch(next, prev, (a, b) => (normKey(a.title) && normKey(a.title) === normKey(b.title) ? 1 : 0), 1, m);
  greedyMatch(next, prev, (a, b) => matchItems(a.items, b.items).size, 1, m);
  return m;
}

/**
 * After a re-import, carry ids over from the previous version wherever content matches, so
 * "Changes vs master" in existing jobs keeps meaning something. Sections match by title,
 * items by title (+subtitle), bullets by identical text first and then by closest wording
 * (each old id is used at most once). Unmatched things keep their new ids. Facts from the
 * previous version are kept and merged with any in `next`.
 */
export function reconcileIds(prev: Resume, next: Resume): Resume {
  const carried = { section: new Set<string>(), item: new Set<string>(), bullet: new Set<string>() };
  const fresh: { kind: keyof typeof carried; node: { id: string } }[] = [];
  const take = <T extends { id: string }>(kind: keyof typeof carried, node: T, from: { id: string } | undefined): T => {
    const out = { ...node, id: from ? from.id : node.id };
    if (from) carried[kind].add(from.id);
    else fresh.push({ kind, node: out });
    return out;
  };

  const sm = matchSections(next.sections, prev.sections);
  const sections = next.sections.map((s, si) => {
    const ps = sm.has(si) ? prev.sections[sm.get(si)!] : undefined;
    const im = ps ? matchItems(s.items, ps.items) : new Map<number, number>();
    const items = s.items.map((it, ii) => {
      const pit = ps && im.has(ii) ? ps.items[im.get(ii)!] : undefined;
      const bm = pit ? matchBullets(it.bullets, pit.bullets) : new Map<number, number>();
      const bullets = it.bullets.map((b, bi) => take("bullet", b, pit && bm.has(bi) ? pit.bullets[bm.get(bi)!] : undefined));
      return take("item", { ...it, bullets }, pit);
    });
    return take("section", { ...s, items }, ps);
  });
  // A new node whose id happens to equal a carried-over id would make two nodes share an id.
  for (const { kind, node } of fresh) if (carried[kind].has(node.id)) node.id = uid();

  const out: Resume = { ...next, version: next.version ?? prev.version ?? RESUME_VERSION, sections };
  delete out.facts;
  if (!prev.facts?.length && !next.facts?.length) return out;
  return addFacts({ ...out, facts: [...(prev.facts ?? [])] }, next.facts ?? []);
}

export function wordCount(r: Resume): number {
  return resumeToPlainText(r).split(/\s+/).filter(Boolean).length;
}
