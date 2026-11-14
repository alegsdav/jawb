import type { Item, Resume, Section } from "./types";
import { guardNumbers, knownNumbers } from "./analysis";
import { normalizeResume, RESUME_VERSION, uid } from "./resume";

/**
 * The guided builder ("I don't have a resume yet"): a three-step wizard whose answers become a
 * Harvard-format master resume. The structure (header, education, entries, dates, skills) is built
 * here from exactly what the student typed; the AI only drafts each experience's bullets, using only
 * that experience's own words, and every number in a draft bullet must appear in that experience's
 * own answer (anything else becomes a [placeholder]).
 */

export const EXPERIENCE_TYPES = [
  { value: "internship", label: "Internship" },
  { value: "job", label: "Job" },
  { value: "project", label: "Project" },
  { value: "club", label: "Club or leadership" },
  { value: "volunteer", label: "Volunteering" },
  { value: "research", label: "Research" },
] as const;
export type ExperienceType = (typeof EXPERIENCE_TYPES)[number]["value"];

export type Experience = {
  id: string;
  type: ExperienceType;
  /** Organization, or the project's name. */
  org: string;
  role: string;
  start: string;
  end: string;
  location: string;
  /** "What did you actually do?" in a few sentences: the only source for its bullets. */
  what: string;
};

export type BuilderState = {
  step: 1 | 2 | 3;
  about: {
    name: string;
    email: string;
    phone: string;
    location: string;
    links: string;
    school: string;
    degree: string;
    major: string;
    graduation: string;
    gpa: string;
  };
  experiences: Experience[];
  skills: { languages: string; tools: string; other: string };
};

export const newExperience = (): Experience => ({
  id: uid(), type: "internship", org: "", role: "", start: "", end: "", location: "", what: "",
});

export const emptyBuilder = (email = ""): BuilderState => ({
  step: 1,
  about: { name: "", email, phone: "", location: "", links: "", school: "", degree: "", major: "", graduation: "", gpa: "" },
  experiences: [newExperience()],
  skills: { languages: "", tools: "", other: "" },
});

/** Shortest "what did you do" we accept: a sentence or two, so the AI has something real to work from. */
export const MIN_WHAT = 25;

export type StepErrors = Record<string, string>;

/**
 * What's missing on a step (field key -> plain sentence). Step 1: name, a valid email, school, degree,
 * major and graduation date (GPA optional, 0 to 5 when given). Step 2: at least one experience, each
 * with a name and a few sentences on what they did. Step 3: nothing required.
 */
export function builderStepErrors(s: BuilderState, step: 1 | 2 | 3): StepErrors {
  const e: StepErrors = {};
  if (step === 1) {
    const a = s.about;
    if (!a.name.trim()) e.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim())) e.email = "Enter a valid email.";
    if (!a.school.trim()) e.school = "Enter your school.";
    if (!a.degree.trim()) e.degree = "Enter your degree (e.g. B.S. or B.A.).";
    if (!a.major.trim()) e.major = "Enter your major.";
    if (!a.graduation.trim()) e.graduation = "Enter your graduation date (e.g. May 2027).";
    const gpa = a.gpa.trim();
    if (gpa && !(/^\d(\.\d{1,3})?$/.test(gpa) && Number(gpa) <= 5)) e.gpa = "Enter a GPA like 3.6, or leave it empty.";
  } else if (step === 2) {
    if (!s.experiences.length) e.experiences = "Add at least one experience or project.";
    s.experiences.forEach((x, i) => {
      if (!x.org.trim()) e[`exp${i}.org`] = x.type === "project" ? "Give the project a name." : "Enter the organization.";
      if (x.what.trim().length < MIN_WHAT) e[`exp${i}.what`] = "Write a few sentences about what you actually did.";
    });
  }
  return e;
}

/** localStorage key for the wizard's answers, so a refresh doesn't lose them. */
export const BUILDER_KEY = "jp:builder:v1";

/** Read saved answers (null when missing, unreadable or the wrong shape). */
export function readBuilder(raw: string | null): BuilderState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BuilderState>;
    if (!v || typeof v !== "object" || !v.about || !Array.isArray(v.experiences) || !v.skills) return null;
    const base = emptyBuilder();
    return {
      step: v.step === 2 || v.step === 3 ? v.step : 1,
      about: { ...base.about, ...v.about },
      experiences: v.experiences.map((x) => ({ ...newExperience(), ...x })),
      skills: { ...base.skills, ...v.skills },
    };
  } catch {
    return null;
  }
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** The builder answers from an untrusted request body (lengths capped, at most 8 experiences). */
export function parseBuilderInput(body: unknown): Omit<BuilderState, "step"> | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const a = (b.about ?? {}) as Record<string, unknown>;
  const k = (b.skills ?? {}) as Record<string, unknown>;
  const types = EXPERIENCE_TYPES.map((t) => t.value) as string[];
  const experiences = (Array.isArray(b.experiences) ? b.experiences : []).slice(0, 8).map((raw) => {
    const x = (raw ?? {}) as Record<string, unknown>;
    return {
      id: clip(x.id, 32).replace(/[^\w-]/g, "") || uid(),
      type: (types.includes(String(x.type)) ? x.type : "job") as ExperienceType,
      org: clip(x.org, 120),
      role: clip(x.role, 120),
      start: clip(x.start, 40),
      end: clip(x.end, 40),
      location: clip(x.location, 80),
      what: clip(x.what, 2000),
    };
  });
  const about = {
    name: clip(a.name, 100), email: clip(a.email, 120), phone: clip(a.phone, 40), location: clip(a.location, 80),
    links: clip(a.links, 200), school: clip(a.school, 120), degree: clip(a.degree, 60), major: clip(a.major, 120),
    graduation: clip(a.graduation, 40), gpa: clip(a.gpa, 8),
  };
  if (!about.name || !experiences.some((x) => x.org && x.what)) return null;
  return { about, experiences: experiences.filter((x) => x.org && x.what), skills: { languages: clip(k.languages, 300), tools: clip(k.tools, 300), other: clip(k.other, 300) } };
}

const SECTION_OF: Record<ExperienceType, string> = {
  internship: "Experience",
  job: "Experience",
  research: "Experience",
  volunteer: "Experience",
  project: "Projects",
  club: "Leadership & Activities",
};
const SECTION_ORDER = ["Experience", "Projects", "Leadership & Activities"];

/** Up to 4 draft bullets per experience id from a model reply (`{ bullets: { id: string[] } }`). */
function draftBullets(raw: unknown): Record<string, string[]> {
  const b = (raw as { bullets?: unknown } | null)?.bullets;
  if (!b || typeof b !== "object" || Array.isArray(b)) return {};
  return Object.fromEntries(
    Object.entries(b as Record<string, unknown>).map(([id, list]) => [
      id,
      (Array.isArray(list) ? list : []).filter((t): t is string => typeof t === "string").map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4),
    ]),
  );
}

/**
 * The master resume built from the answers and the AI's draft bullets, through normalizeResume.
 * Header, education, entries and skills come only from the answers. Each experience's bullets are
 * checked with guardNumbers against that experience's own answer (any other number becomes a
 * [placeholder]); an experience without usable bullets gets one placeholder bullet to fill in.
 * Entry ids are the experience ids, so builder facts can link to them.
 */
export function buildDraftResume(input: Omit<BuilderState, "step">, raw: unknown): Resume {
  const { about, experiences, skills } = input;
  const bullets = draftBullets(raw);
  const contact = [about.location, about.email, about.phone, about.links].map((x) => x.trim()).filter(Boolean).join(" • ");
  const degree = [about.degree.trim(), about.major.trim()].filter(Boolean).join(" in ");
  const education: Item = {
    id: uid(),
    title: about.school.trim(),
    subtitle: degree,
    location: "",
    dates: about.graduation.trim(),
    bullets: about.gpa.trim() ? [{ id: uid(), text: `GPA: ${about.gpa.trim()}` }] : [],
  };
  const sections: Section[] = [];
  if (education.title || education.subtitle) sections.push({ id: uid(), title: "Education", items: [education] });
  for (const title of SECTION_ORDER) {
    const items: Item[] = experiences
      .filter((x) => SECTION_OF[x.type] === title)
      .map((x) => {
        const known = knownNumbers([x.what, x.role, x.org]);
        const drafted = (bullets[x.id] ?? []).map((t) => guardNumbers(t, known).text);
        const dates = x.start.trim() ? `${x.start.trim()} – ${x.end.trim() || "Present"}` : x.end.trim();
        return {
          id: x.id,
          title: x.org.trim(),
          subtitle: x.role.trim(),
          location: x.location.trim(),
          dates,
          bullets: (drafted.length ? drafted : ["[What you did and what came of it]"]).map((text) => ({ id: uid(), text })),
        };
      });
    if (items.length) sections.push({ id: uid(), title, items });
  }
  const skillItems: Item[] = (
    [
      ["Languages", skills.languages],
      ["Tools", skills.tools],
      ["Other", skills.other],
    ] as const
  )
    .filter(([, v]) => v.trim())
    .map(([label, v]) => ({ id: uid(), title: label, subtitle: v.trim(), location: "", dates: "", bullets: [] }));
  if (skillItems.length) sections.push({ id: uid(), title: "Skills", items: skillItems });
  return normalizeResume({ version: RESUME_VERSION, header: { name: about.name.trim(), contact }, sections });
}

/** The builder's raw "what did you do" answers, as facts linked to their entries on the master. */
export const builderFacts = (input: Omit<BuilderState, "step">, masterId: string | null) =>
  input.experiences.map((x) => ({
    text: `${[x.role, x.org].filter(Boolean).join(", ")}: ${x.what.replace(/\s+/g, " ").trim()}`,
    source: "builder" as const,
    resume_id: masterId,
    entry_id: masterId ? x.id : null,
  }));
