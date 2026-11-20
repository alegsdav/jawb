"use client";

import type { Job } from "@/lib/types";
import { SUBMITTED_STATUSES } from "@/lib/outcomes";
import { DeadlineField } from "../DeadlineField";
import { Menu, MenuItem } from "../Menu";
import { ChevronDownIcon } from "../icons";

/** Borderless input that's exactly as wide as its text: the hidden sizing text sets the width, the input sits over it. */
function FitInput({
  value, placeholder, onChange, className = "",
}: { value: string; placeholder: string; onChange: (v: string) => void; className?: string }) {
  return (
    <span className={`relative inline-grid shrink-0 ${className}`}>
      {/* Same font size as the input: phones force fields to 16px (globals.css), so the sizing text does too. */}
      <span aria-hidden className="invisible max-w-full overflow-hidden whitespace-pre border border-transparent px-1 py-0.5 text-[16px] sm:text-[13px]">
        {value || placeholder}
      </span>
      <input
        className="ghost-input absolute inset-0 w-full min-w-0 text-[13px]"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

const TITLE_TEXT = "text-lg font-semibold leading-snug tracking-tight";

/**
 * The job title, in the side panel's h1. A long title wraps onto as many lines as it needs: a hidden copy
 * sets the height and the textarea sits over it (the same trick as FitInput). Enter doesn't add a line.
 */
function TitleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <h1 className="relative -mx-[5px] min-w-0 flex-1">
      <span aria-hidden className={`invisible block whitespace-pre-wrap break-words rounded-lg border border-transparent px-1 py-0.5 ${TITLE_TEXT}`}>
        {value || "Job title"}{" "}
      </span>
      <textarea
        rows={1}
        className={`ghost-input absolute inset-0 h-full w-full resize-none overflow-hidden ${TITLE_TEXT}`}
        value={value}
        placeholder="Job title"
        aria-label="Job title"
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      />
    </h1>
  );
}

/** Status, Follow up and Deadline share one control size, so the column lines up. */
const CONTROL = "flex h-8 w-44 items-center [&>*]:h-full [&>*]:w-full [&_input]:w-full [&_select]:w-full";

/**
 * The job's details block at the top of the side panel. The title always shows, with a "⋯" menu for
 * Delete job; on phones the rest (company and location, status, deadline, follow-up) sits behind a
 * "Details" toggle so the document isn't pushed down. On desktop it's all shown as a compact list.
 */
export function JobHeader({
  job, applied, statusSelect, detailsOpen, onToggleDetails, onPatch, onDelete,
}: {
  job: Job;
  applied: boolean;
  statusSelect: React.ReactNode;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onPatch: (p: Partial<Job>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <TitleField value={job.title} onChange={(v) => onPatch({ title: v })} />
        <Menu
          label="⋯"
          title="More actions"
          buttonClassName="shrink-0 rounded-md px-2 py-0.5 text-lg leading-none text-muted hover:bg-surface-2 hover:text-fg"
        >
          <MenuItem onSelect={onDelete} danger>
            Delete job
          </MenuItem>
        </Menu>
      </div>

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
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-[13px] text-muted">
            {/* -mx-[5px]: the inputs' padding and border sit outside the text, so the text lines up with the labels. */}
            <FitInput className="max-w-full -mx-[5px]" value={job.company} placeholder="Company" onChange={(v) => onPatch({ company: v })} />
            <span aria-hidden>·</span>
            <FitInput className="max-w-full -mx-[5px]" value={job.location} placeholder="Location" onChange={(v) => onPatch({ location: v })} />
          </div>
          {job.url && (
            // Not "Posting": that's also the name of a tab.
            <a href={job.url} target="_blank" rel="noreferrer" className="-ml-1 inline-block px-1 py-0.5 text-[13px] text-muted underline underline-offset-2 hover:text-fg">
              Open posting ↗
            </a>
          )}
        </div>

        <div className="grid grid-cols-[84px_1fr] items-center gap-x-3 gap-y-1.5 text-[13px]">
          {!applied && (
            <>
              <span className="text-muted">Status</span>
              {/* The select's dot sits 10px in; pull the wrapper back so the dot lines up with the other values. */}
              <div className={`${CONTROL} -ml-2.5`}>{statusSelect}</div>
            </>
          )}
          {/* DeadlineField's own label sits in the same 84px column as the other labels. */}
          <div className="col-span-2 [&_label]:gap-3 [&_label>span]:w-[84px] [&_label>span]:shrink-0 [&_label>span]:text-[13px] [&_input]:h-8 [&_input]:w-44 [&_input]:text-[13px] [&_input]:sm:-ml-[5px]">
            <DeadlineField compact value={job.deadline ?? null} status={job.status} onChange={(v) => onPatch({ deadline: v })} />
          </div>
          {SUBMITTED_STATUSES.has(job.status) && (
            <>
              <span className="text-muted">Follow up</span>
              <div className={`${CONTROL} sm:-ml-[5px]`}>
                <input
                  type="date"
                  aria-label="Follow-up date"
                  className="ghost-input text-[13px] border-border sm:border-transparent"
                  value={job.follow_up_date ?? ""}
                  onChange={(e) => onPatch({ follow_up_date: e.target.value || null })}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
