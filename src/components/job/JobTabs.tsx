"use client";

import type { Job } from "@/lib/types";
import { countPlaceholders, plural } from "@/lib/facts";
import { PlaceholderTextarea } from "../PlaceholderTextarea";
import { PostingView } from "./PostingView";

/** The Posting tab: the posting as a readable document, editable in place (see PostingView). */
export function PostingTab({ job, onPatch }: { job: Job; onPatch: (p: Partial<Job>) => void }) {
  return <PostingView job={job} onPatch={onPatch} />;
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
  // Text buttons on the canvas: the primary action is the one bold line, the rest are muted until hovered.
  const textButton = "inline-flex min-h-10 items-center text-[13px] underline-offset-2 hover:underline disabled:no-underline disabled:opacity-50 sm:min-h-0";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {quiet && <p className="text-[13px] text-muted">The letter as you last saved it here.</p>}
        {!quiet && (
          <button type="button" className={`${textButton} font-medium text-fg`} onClick={onWrite} disabled={writing || !canWrite}>
            {writing ? "Writing…" : job.cover_letter ? "Regenerate" : "Draft cover letter"}
          </button>
        )}
        {job.cover_letter && (
          <button type="button" className={`${textButton} text-muted`} onClick={onCopy}>
            Copy as text
          </button>
        )}
        {coverPlaceholders > 0 && !quiet && (
          <span className="text-[13px] text-muted">{plural(coverPlaceholders, "placeholder")} left</span>
        )}
      </div>
      {error && !writing && !quiet && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="text-bad">{error}</span>
          <button type="button" className={`${textButton} text-fg`} onClick={onWrite}>Retry</button>
        </div>
      )}
      {/* The letter reads as a document: no box, no border. Its text color comes from the page (the highlight layer
          behind it is transparent text, so the color must not be set on the shared box classes). */}
      <div className="mt-6">
        <PlaceholderTextarea
          boxClassName="w-full min-h-[50vh] text-[15px] leading-relaxed"
          className="focus:outline-none"
          value={job.cover_letter}
          placeholder="Draft a cover letter, or write your own here."
          aria-label="Cover letter"
          onChange={(e) => onPatch({ cover_letter: e.target.value })}
        />
      </div>
    </div>
  );
}
