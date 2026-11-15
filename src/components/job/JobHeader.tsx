"use client";

import type { Job } from "@/lib/types";
import { SaveStatus } from "@/lib/useAutosave";
import { DeadlineField } from "../DeadlineField";
import { ChevronDownIcon } from "../icons";

/** Borderless input that's exactly as wide as its text: the hidden sizing text sets the width, the input sits over it. */
function FitInput({
  value, placeholder, onChange, className = "",
}: { value: string; placeholder: string; onChange: (v: string) => void; className?: string }) {
  return (
    <span className={`relative inline-grid shrink-0 ${className}`}>
      <span aria-hidden className="invisible max-w-full overflow-hidden whitespace-pre border border-transparent px-1 py-0.5">
        {value || placeholder}
      </span>
      <input
        className="ghost-input absolute inset-0 w-full min-w-0 font-[inherit] text-[length:inherit] leading-[inherit]"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

/**
 * The job's details block at the top of the side panel. The title always shows; on phones everything
 * else (company and location, status, save state, follow-up, deadline, delete) sits behind a "Details"
 * toggle so the document isn't pushed down. On desktop it's all shown as a compact definition list.
 */
export function JobHeader({
  job, applied, statusSelect, followUp, saveState, detailsOpen, onToggleDetails, onPatch, onDelete,
}: {
  job: Job;
  applied: boolean;
  statusSelect: React.ReactNode;
  /** The follow-up date as a grid row (label + input). */
  followUp: React.ReactNode;
  saveState: string;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onPatch: (p: Partial<Job>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-2">
      <input
        className="ghost-input w-full text-lg font-semibold tracking-tight"
        value={job.title}
        placeholder="Job title"
        aria-label="Job title"
        onChange={(e) => onPatch({ title: e.target.value })}
      />

      <button
        type="button"
        className="flex w-full items-center justify-between py-2 text-[13px] text-muted sm:hidden"
        aria-expanded={detailsOpen}
        aria-controls="job-details"
        onClick={onToggleDetails}
      >
        Details
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      <div id="job-details" className={`${detailsOpen ? "block" : "hidden"} space-y-3 sm:block`}>
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
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

        <div className="grid grid-cols-[84px_1fr] items-center gap-x-3 gap-y-1.5 text-[13px]">
          {!applied && (
            <>
              <span className="text-muted">Status</span>
              <div className="justify-self-start">{statusSelect}</div>
            </>
          )}
          <span className="text-muted">Saved</span>
          <div className="justify-self-start">
            <SaveStatus status={saveState} />
          </div>
          {!applied && followUp}
          {/* DeadlineField's own label sits in the same 84px column as the other labels. */}
          <div className="col-span-2 [&_label]:gap-3 [&_label>span]:w-[84px] [&_label>span]:shrink-0">
            <DeadlineField compact value={job.deadline ?? null} status={job.status} onChange={(v) => onPatch({ deadline: v })} />
          </div>
        </div>

        <button type="button" className="block text-xs text-muted hover:text-bad" onClick={onDelete}>
          Delete job
        </button>
      </div>
    </div>
  );
}
