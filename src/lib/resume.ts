import type { Item, Resume, Section } from "./types";

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

export function wordCount(r: Resume): number {
  return resumeToPlainText(r).split(/\s+/).filter(Boolean).length;
}
