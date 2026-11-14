import type { Fit, JobStatus } from "./types";
import { fitOf } from "./fit";

/** What the sidebar shows for one job (a small select: no descriptions or analyses). */
export type NavJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  status: JobStatus;
  updated_at: string;
  fit: Fit | null;
};

/** Columns for the sidebar's query: the fit is read straight out of the analysis JSON. */
export const NAV_JOB_COLS = "id, title, company, location, status, updated_at, fit:analysis->>fit, fit_score:analysis->fit_score";

/** A row from NAV_JOB_COLS as a NavJob (old analyses only have a 0-100 fit_score). */
export function navJob(row: Record<string, unknown>): NavJob {
  const fitRaw = typeof row.fit === "string" ? row.fit : undefined;
  const score = typeof row.fit_score === "number" ? row.fit_score : undefined;
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    company: String(row.company ?? ""),
    location: String(row.location ?? ""),
    status: (row.status as JobStatus) ?? "to_apply",
    updated_at: String(row.updated_at ?? ""),
    fit: fitRaw || score !== undefined ? fitOf({ fit: fitRaw as Fit | undefined, fit_score: score }) : null,
  };
}

/** The most recently updated jobs, newest first. */
export const recentJobs = (jobs: NavJob[], n = 8) => [...jobs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, n);

/** Jobs whose title, company or location contain every word of the query (case-insensitive). */
export function searchJobs(jobs: NavJob[], query: string, n = 20): NavJob[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return recentJobs(jobs, jobs.length)
    .filter((j) => {
      const hay = `${j.title} ${j.company} ${j.location}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, n);
}
