"use client";

import type { Job } from "@/lib/types";
import { SaveStatus } from "@/lib/useAutosave";
import { DeadlineField } from "../DeadlineField";

/** Borderless input that's as wide as its text (company name next to the location on one line). */
function FitInput({
  value, placeholder, onChange, className = "",
}: { value: string; placeholder: string; onChange: (v: string) => void; className?: string }) {
  return (
    <span className={`inline-grid min-w-0 ${className}`}>
      <span aria-hidden className="invisible whitespace-pre col-start-1 row-start-1 px-1 py-0.5 border border-transparent overflow-hidden">
        {value || placeholder}
      </span>
      <input
        size={1}
        className="ghost-input col-start-1 row-start-1 w-full min-w-0"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

/**
 * The job page's header: title, company and location (edited in place), the posting link, status,
 * save state, and (in a "Details" disclosure on phones) follow-up, deadline and Delete job.
 */
export function JobHeader({
  job, applied, statusSelect, followUp, saveState, detailsOpen, onToggleDetails, onPatch, onDelete,
}: {
  job: Job;
  applied: boolean;
  statusSelect: React.ReactNode;
  followUp: React.ReactNode;
  saveState: string;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onPatch: (p: Partial<Job>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <div className="w-full lg:flex-1 lg:min-w-64">
        <input
          className="ghost-input w-full text-lg sm:text-xl font-semibold"
          value={job.title}
          placeholder="Job title"
          aria-label="Job title"
          onChange={(e) => onPatch({ title: e.target.value })}
        />
        <div className="flex items-center gap-0.5 text-base sm:text-sm text-muted min-w-0">
          <FitInput className="max-w-[55%] shrink-0" value={job.company} placeholder="Company" onChange={(v) => onPatch({ company: v })} />
          <span aria-hidden>·</span>
          <FitInput className="flex-1 sm:flex-none" value={job.location} placeholder="Location" onChange={(v) => onPatch({ location: v })} />
          {job.url && (
            // Not "Posting": that's also the name of a tab.
            <a href={job.url} target="_blank" rel="noreferrer" className="shrink-0 px-1 py-0.5 text-sm underline hover:text-fg">
              Open posting ↗
            </a>
          )}
        </div>
      </div>
      <div className="flex w-full lg:w-auto flex-wrap items-center gap-x-3 gap-y-2">
        {!applied && statusSelect}
        <button
          type="button"
          className="sm:hidden btn btn-sm min-h-10"
          aria-expanded={detailsOpen}
          aria-controls="job-details"
          onClick={onToggleDetails}
        >
          Details {detailsOpen ? "▴" : "▾"}
        </button>
        <span className="ml-auto lg:ml-0">
          <SaveStatus status={saveState} />
        </span>
        {/* Phones: inside the "Details" disclosure. Desktop: inline. */}
        <div
          id="job-details"
          className={`${detailsOpen ? "flex" : "hidden"} sm:flex w-full sm:w-auto flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface p-2 sm:border-0 sm:bg-transparent sm:p-0`}
        >
          {!applied && followUp}
          <DeadlineField compact value={job.deadline ?? null} status={job.status} onChange={(v) => onPatch({ deadline: v })} />
          <button type="button" className="text-xs text-muted hover:text-bad py-1 min-h-10 sm:min-h-0 ml-auto sm:ml-0" onClick={onDelete}>
            Delete job
          </button>
        </div>
      </div>
    </div>
  );
}
