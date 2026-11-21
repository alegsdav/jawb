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

// ---------- per-device memory: recent visits and pins ----------
// Both live in localStorage, so they are per browser, not per account. Storage can be blocked, so every
// read and write is guarded and falls back to "nothing saved".

export const VISITS_KEY = "jawb_job_visits";
export const PINS_KEY = "jawb_pinned_jobs";
/** How many visits to remember; older ones fall off the log. */
export const MAX_VISITS = 50;

/** Job id -> ISO time it was last opened on this device. */
export type Visits = Record<string, string>;

export function readVisits(): Visits {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(VISITS_KEY) ?? "null");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Visits) : {};
  } catch {
    return {};
  }
}

export function saveVisits(visits: Visits): void {
  try {
    localStorage.setItem(VISITS_KEY, JSON.stringify(visits));
  } catch {
    /* blocked storage: the order just lasts this page view */
  }
}

/** The log with `id` opened at `now`, keeping only the newest MAX_VISITS. Pure. */
export function withVisit(visits: Visits, id: string, now = new Date().toISOString()): Visits {
  const newest = Object.entries({ ...visits, [id]: now })
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, MAX_VISITS);
  return Object.fromEntries(newest);
}

/** The log without a job (after it is deleted). Pure. */
export function withoutVisit(visits: Visits, id: string): Visits {
  const next = { ...visits };
  delete next[id];
  return next;
}

/** Record a visit on this device and return the new log. */
export function recordVisit(id: string, now?: string): Visits {
  const next = withVisit(readVisits(), id, now);
  saveVisits(next);
  return next;
}

export function readPins(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PINS_KEY) ?? "null");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function savePins(pins: string[]): void {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    /* blocked storage: pins last this page view */
  }
}

/** Pin list with `id` added as the newest pin (first). Pure. */
export const withPin = (pins: string[], id: string): string[] => [id, ...pins.filter((p) => p !== id)];

/** Pin list without `id`. Pure. */
export const withoutPin = (pins: string[], id: string): string[] => pins.filter((p) => p !== id);

// ---------- ordering ----------

/** When a job last mattered on this device: its last save, or its last visit if that was later. */
const touched = (j: NavJob, visits: Visits) => Math.max(Date.parse(j.updated_at) || 0, Date.parse(visits[j.id] ?? "") || 0);

/** The most recently updated or visited jobs, newest first. */
export const recentJobs = (jobs: NavJob[], n = 8, visits: Visits = {}) =>
  [...jobs].sort((a, b) => touched(b, visits) - touched(a, visits)).slice(0, n);

/** Jobs whose title, company or location contain every word of the query (case-insensitive). Pins are ignored. */
export function searchJobs(jobs: NavJob[], query: string, n = 20, visits: Visits = {}): NavJob[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return recentJobs(jobs, jobs.length, visits)
    .filter((j) => {
      const hay = `${j.title} ${j.company} ${j.location}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, n);
}

/**
 * The sidebar's two groups: the pinned jobs (newest pin first) and the recent jobs, which leave out
 * the pinned ones. Pins that point at a job that is gone are skipped.
 */
export function sidebarJobs(jobs: NavJob[], pins: string[], visits: Visits, n = 8): { pinned: NavJob[]; recent: NavJob[] } {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const pinned = pins.map((id) => byId.get(id)).filter((j): j is NavJob => !!j);
  const pinnedIds = new Set(pinned.map((j) => j.id));
  return { pinned, recent: recentJobs(jobs.filter((j) => !pinnedIds.has(j.id)), n, visits) };
}
