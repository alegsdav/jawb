import type { DocJSON, PageSetup } from "./doc/types";

/**
 * Inline formatting over the characters [from, to) of one plain-text field (a bullet's text, an entry's
 * title, ...). The text itself stays plain, so the AI, the number checks, placeholders and facts read it
 * unchanged; formatting lives next to it. Canonical form (see cleanMarks in richText.ts): sorted,
 * non-overlapping, each range carries its full format, ranges with no format are omitted, adjacent equal
 * ranges are merged. Absent flags mean regular weight, upright, no underline, 11pt.
 */
export type Mark = { from: number; to: number; bold?: true; italic?: true; underline?: true; size?: number };

/** Line (paragraph) formatting. Absent = left aligned, no rule line, normal case, no extra space. */
export type Para = {
  align?: "center" | "right" | "justify";
  /** A thin line under the paragraph (the template uses it under section headings). */
  rule?: true;
  /** Shown in ALL CAPS (the stored text keeps its own case). */
  caps?: true;
  /** Extra space above the paragraph, in points. */
  spaceBefore?: number;
};

export type Bullet = { id: string; text: string; marks?: Mark[]; para?: Para };

/** Legacy (resume version 2) whole-field bold/italic override. Only read when migrating old data (textStyle.ts). */
export type TextStyle = { bold?: boolean; italic?: boolean };

/**
 * One entry in a section. Its lines in the document:
 *   title              location        (the "entry" line; location right-aligned after a tab)
 *   subtitle           dates           (the "role" line; only when subtitle or dates is set)
 *   bullets
 * Items with no bullets, dates or location are one plain line (`title`; `subtitle` is only non-empty in
 * data from before version 3, where the line was "title: subtitle").
 * Formatting is explicit (marks/para); nothing about a field implies a look.
 */
export type Item = {
  id: string;
  title: string;
  subtitle: string;
  location: string;
  dates: string;
  bullets: Bullet[];
  /** Inline formatting per field. Omitted when no field has any. */
  marks?: { title?: Mark[]; subtitle?: Mark[]; location?: Mark[]; dates?: Mark[] };
  /** Paragraph formatting of the entry line (or the plain line of an inline item) and of the role line. */
  para?: { entry?: Para; role?: Para };
};

export type Section = {
  id: string;
  title: string;
  items: Item[];
  /** Inline formatting of the section title. */
  marks?: Mark[];
  /** Paragraph formatting of the section heading line. */
  para?: Para;
};

export type Resume = {
  /**
   * 4 = the document (`doc`) is the source of truth. 3 = explicit formatting (marks/para). 2 = Harvard defaults
   * implied by field, with `styles` overrides. 2+ = title is the organization/school (line 1), subtitle is the
   * role/degree (line 2). Versions 1-3 are migrated to a document by normalizeResume (see doc/legacy.ts).
   */
  version?: number;
  /** The resume document (TipTap JSON, see doc/types.ts). Required from version 4; the source of truth. */
  doc?: DocJSON;
  /** Page margins in inches (see doc/types.ts). Absent = PAGE_DEFAULTS. */
  page?: PageSetup;
  /**
   * DERIVED from `doc` by outlineFromDoc (via withDoc), for the AI, facts and coaching code. Not edited directly in
   * version 4: change the document instead.
   */
  header: {
    name: string;
    contact: string;
    marks?: { name?: Mark[]; contact?: Mark[] };
    para?: { name?: Para; contact?: Para };
  };
  /** DERIVED from `doc` by outlineFromDoc (via withDoc), for the AI, facts and coaching code. Not edited directly in version 4. */
  sections: Section[];
  /**
   * Legacy: the master's facts before they moved to the `facts` table (migration 0005 copied them).
   * Kept as stored (never read or written by the app); see `Fact`.
   */
  facts?: string[];
  /**
   * Tailored copies only: the master's text at the time the copy was made (or last pulled from the
   * master), keyed by bullet id, plus "header.name" / "header.contact". Used to tell which bullets the
   * user edited in the copy and which ones can safely take a newer master wording. Never rendered.
   */
  baseline?: Record<string, string>;
};

/** Where a fact came from (shown as a small label in the Facts panel). */
export type FactSource = "resume" | "builder" | "answer" | "coaching" | "manual" | "extracted" | "legacy";

/**
 * One true thing about the student (migration 0005), fed to the AI so it doesn't re-ask. Never printed,
 * exported to PDF or put in a snapshot. A fact linked to a bullet (resume_id + bullet_id) mirrors that
 * bullet's text; the link is cleared (the fact stays) when the bullet is emptied or deleted. A fact
 * with a [placeholder] is a draft (`active: false`) until the placeholder is filled; the AI sees only
 * active facts.
 */
export type Fact = {
  id: string;
  text: string;
  source: FactSource;
  active: boolean;
  resume_id: string | null;
  bullet_id: string | null;
  entry_id: string | null;
  created_at: string;
  updated_at: string;
};

export type JobStatus = "to_apply" | "applied" | "interview" | "offer" | "rejected" | "skipped";

export const STATUSES: { value: JobStatus; label: string }[] = [
  { value: "to_apply", label: "To apply" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "skipped", label: "Skipped" },
];

/** Coarse fit bucket. A 0-100 score isn't calibrated or stable, so the UI only shows this. */
export type Fit = "strong" | "possible" | "stretch";

export type Analysis = {
  fit: Fit;
  /** @deprecated old analyses stored a number; normalizeAnalysis maps it to `fit`. */
  fit_score?: number;
  verdict: string;
  keywords: { matched: string[]; missing: string[] };
  strengths: string[];
  gaps: { issue: string; severity: "high" | "medium" | "low"; fix: string }[];
  bullets: {
    bullet_id: string;
    rating: "strong" | "ok" | "weak";
    note: string;
    rewrite: string;
    /** One sentence for the student: what the rewrite changes and why a recruiter for this job cares. "" when there is no rewrite or in analyses from before this field. */
    why?: string;
    /** The bullet's text when it was rated. Feedback is stale once the bullet no longer reads like this. */
    original?: string;
  }[];
  questions: {
    id: string;
    question: string;
    why: string;
    /** Set when the question asks for the value of a placeholder in this bullet's suggested rewrite. */
    bullet_id?: string;
    /** That placeholder, e.g. "[N users]". */
    placeholder?: string;
  }[];
  answers?: Record<string, string>;
  /** Bullet ids whose suggested rewrite the user rejected. */
  dismissed?: string[];
  analyzed_at?: string;
};

export type Job = {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  description: string;
  status: JobStatus;
  date_applied: string | null;
  follow_up_date: string | null;
  notes: string;
  analysis: Analysis | null;
  cover_letter: string;
  /** Application deadline (migration 0002). */
  deadline: string | null;
  /** Frozen copy of the tailored resume when the job was marked Applied (migration 0002). */
  submitted_resume: Resume | null;
  submitted_at: string | null;
  /** Whether the submitted resume differed from the master at submit time (for outcome stats). */
  submitted_tailored: boolean | null;
  /** Set the first time the status enters Interview or Offer; stays true after a later Rejected (migration 0003). */
  reached_interview?: boolean | null;
  /** Suggested rewrites in the latest analysis (migration 0006; null = not analyzed). */
  suggestions_total?: number | null;
  /** Of those, how many still wait for accept/reject (migration 0006). */
  suggestions_pending?: number | null;
  created_at: string;
  updated_at: string;
};

export type ResumeRow = {
  id: string;
  name: string;
  is_master: boolean;
  job_id: string | null;
  content: Resume;
  updated_at: string;
};
