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
 * The job's details block at the top of the side panel: title, company and location (edited in place),
 * the posting link, then a small list of status, save state, follow-up and deadline. On phones the
 * follow-up, deadline and Delete job sit inside a "Details" disclosure.
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
    <div className="space-y-3">
      <div className="min-w-0 space-y-1">
        <input
          className="ghost-input w-full text-lg font-semibold tracking-tight"
          value={job.title}
          placeholder="Job title"
          aria-label="Job title"
          onChange={(e) => onPatch({ title: e.target.value })}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-x-0.5 text-[13px] text-muted">
          <FitInput className="max-w-full" value={job.company} placeholder="Company" onChange={(v) => onPatch({ company: v })} />
          <span aria-hidden>·</span>
          <FitInput className="max-w-full" value={job.location} placeholder="Location" onChange={(v) => onPatch({ location: v })} />
        </div>
        {job.url && (
          // Not "Posting": that's also the name of a tab.
          <a href={job.url} target="_blank" rel="noreferrer" className="inline-block px-1 py-0.5 text-[13px] text-muted underline underline-offset-2 hover:text-fg">
            Open posting ↗
          </a>
        )}
      </div>

      <div className="space-y-2 text-[13px]">
        {!applied && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Status</span>
            {statusSelect}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">Saved</span>
          <SaveStatus status={saveState} />
        </div>

        <button
          type="button"
          className="sm:hidden btn btn-sm min-h-10 w-full"
          aria-expanded={detailsOpen}
          aria-controls="job-details"
          onClick={onToggleDetails}
        >
          Details {detailsOpen ? "▴" : "▾"}
        </button>
        {/* Phones: inside the "Details" disclosure. Desktop: always shown. */}
        <div id="job-details" className={`${detailsOpen ? "block" : "hidden"} space-y-2 sm:block`}>
          {!applied && <div>{followUp}</div>}
          <div>
            <DeadlineField compact value={job.deadline ?? null} status={job.status} onChange={(v) => onPatch({ deadline: v })} />
          </div>
        </div>
      </div>

      <button type="button" className="py-1 text-[13px] text-muted hover:text-bad" onClick={onDelete}>
        Delete job
      </button>
    </div>
  );
}
