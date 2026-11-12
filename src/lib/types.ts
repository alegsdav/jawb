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

export type Analysis = {
  fit_score: number;
  verdict: string;
  keywords: { matched: string[]; missing: string[] };
  strengths: string[];
  gaps: { issue: string; severity: "high" | "medium" | "low"; fix: string }[];
  bullets: { bullet_id: string; rating: "strong" | "ok" | "weak"; note: string; rewrite: string }[];
  bank_suggestions: { bank_id: string; reason: string }[];
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
  created_at: string;
  updated_at: string;
};

export type BankBullet = {
  id: string;
  source: string;
  text: string;
  tags: string[];
  created_at: string;
};

export type ResumeRow = {
  id: string;
  name: string;
  is_master: boolean;
  job_id: string | null;
  content: Resume;
  updated_at: string;
};
