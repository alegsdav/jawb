export type Bullet = { id: string; text: string };

/**
 * One entry in a section, laid out Harvard-style:
 *   title (bold)              location
 *   subtitle (italic)         dates
 *   • bullets
 * Items with no bullets, dates or location render as one inline line ("Languages: Python, SQL").
 */
export type Item = {
  id: string;
  title: string;
  subtitle: string;
  location: string;
  dates: string;
  bullets: Bullet[];
};

export type Section = { id: string; title: string; items: Item[] };

export type Resume = {
  /** 2 = title is the organization/school (line 1), subtitle is the role/degree (line 2). */
  version?: number;
  header: { name: string; contact: string };
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
