"use client";

import type { Job } from "@/lib/types";
import { countPlaceholders, plural } from "@/lib/facts";
import { PlaceholderTextarea } from "../PlaceholderTextarea";

/** The Posting tab: link, description and notes, edited in place. */
export function PostingTab({ job, onPatch }: { job: Job; onPatch: (p: Partial<Job>) => void }) {
  return (
    <div className="card p-4 space-y-3">
      <input
        className="input w-full text-sm"
        value={job.url}
        placeholder="Posting URL"
        aria-label="Posting URL"
        onChange={(e) => onPatch({ url: e.target.value })}
      />
      <textarea
        className="input w-full min-h-[60vh] text-sm leading-relaxed"
        value={job.description}
        aria-label="Job description"
        placeholder="Paste the job description here."
        onChange={(e) => onPatch({ description: e.target.value })}
      />
      <textarea
        className="input w-full h-24 text-sm"
        value={job.notes}
        placeholder="Notes: referral, recruiter name…"
        aria-label="Notes"
        onChange={(e) => onPatch({ notes: e.target.value })}
      />
    </div>
  );
}

/** The Letter tab: draft (or regenerate) a cover letter, copy it, or write your own. */
export function CoverLetterTab({
  job, quiet, writing, error, canWrite, onWrite, onCopy, onPatch,
}: {
  job: Job;
  /** Applied and not re-applying: read-only wording, no drafting. */
  quiet: boolean;
  writing: boolean;
  error: string;
  canWrite: boolean;
  onWrite: () => void;
  onCopy: () => void;
  onPatch: (p: Partial<Job>) => void;
}) {
  const coverPlaceholders = countPlaceholders([job.cover_letter]);
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted flex-1 min-w-48">
          {quiet ? "The letter as you last saved it here." : "Only send one if the application asks. Replace every [placeholder] first."}
        </p>
        {coverPlaceholders > 0 && !quiet && (
          <span className="chip border-[#e0b100] bg-[#fff6d6] text-[#5c4300]">
            {plural(coverPlaceholders, "placeholder")} left
          </span>
        )}
        {job.cover_letter && (
          <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={onCopy}>
            Copy as text
          </button>
        )}
        {!quiet && (
          <button
            type="button"
            className="btn btn-sm btn-primary min-h-10 sm:min-h-0"
            onClick={onWrite}
            disabled={writing || !canWrite}
          >
            {writing ? "Writing…" : job.cover_letter ? "Regenerate" : "Draft cover letter"}
          </button>
        )}
      </div>
      {error && !writing && !quiet && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-bad/40 bg-bad-bg px-3 py-2 text-sm">
          <span className="flex-1 min-w-48 text-bad">{error}</span>
          <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={onWrite}>Retry</button>
        </div>
      )}
      <PlaceholderTextarea
        boxClassName="input w-full min-h-[50vh] text-sm leading-relaxed"
        value={job.cover_letter}
        placeholder="Draft a cover letter, or write your own here."
        aria-label="Cover letter"
        onChange={(e) => onPatch({ cover_letter: e.target.value })}
      />
    </div>
  );
}
