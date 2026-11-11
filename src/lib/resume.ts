import type { Item, Resume, Section } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10);

export const emptyItem = (): Item => ({
  id: uid(), title: "", subtitle: "", location: "", dates: "", bullets: [{ id: uid(), text: "" }],
});

export const emptySection = (title = "New section"): Section => ({
  id: uid(), title, items: [emptyItem()],
});

export const emptyResume = (): Resume => ({
  header: { name: "Your Name", contact: "City, ST • email • phone • github.com/you" },
  sections: [
    { id: uid(), title: "Education", items: [{ ...emptyItem(), bullets: [] }] },
    emptySection("Experience"),
    emptySection("Projects"),
    { id: uid(), title: "Skills", items: [{ ...emptyItem(), title: "Languages", bullets: [] }] },
  ],
});

/** Make sure every section/item/bullet has an id (AI output or old data may lack them). */
export function normalizeResume(raw: unknown): Resume {
  const r = (raw ?? {}) as Partial<Resume>;
  return {
    header: {
      name: r.header?.name ?? "",
      contact: r.header?.contact ?? "",
    },
    sections: (r.sections ?? []).map((s) => ({
      id: s.id || uid(),
      title: s.title ?? "",
      items: (s.items ?? []).map((it) => ({
        id: it.id || uid(),
        title: it.title ?? "",
        subtitle: it.subtitle ?? "",
        location: it.location ?? "",
        dates: it.dates ?? "",
        bullets: (it.bullets ?? []).map((b) =>
          typeof b === "string" ? { id: uid(), text: b } : { id: b.id || uid(), text: b.text ?? "" },
        ),
      })),
    })),
  };
}

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

export function wordCount(r: Resume): number {
  return resumeToPlainText(r).split(/\s+/).filter(Boolean).length;
}
