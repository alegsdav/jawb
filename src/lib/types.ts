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
   * Master only: true facts about the candidate that don't fit on the page (numbers, tools, extra
   * projects, answers to analysis questions). Never rendered or exported to PDF; fed to the AI as context.
   */
  facts?: string[];
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
  bullets: { bullet_id: string; rating: "strong" | "ok" | "weak"; note: string; rewrite: string }[];
  questions: { id: string; question: string; why: string }[];
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
