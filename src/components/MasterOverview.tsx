"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { MasterAnalysis } from "@/lib/types";
import { FlowText, flowEndMs } from "./FlowText";
import { LoadingState } from "@/components/ui/loading-state";
import { RefreshIcon } from "./icons";

/**
 * The intro plays once per page view. The Overview remounts on every tab switch, so this module flag (not the
 * component's state) is what remembers the intro already played.
 */
let introPlayed = false;

function useIntro(): boolean {
  const [play] = useState(() => !introPlayed);
  useEffect(() => {
    introPlayed = true;
  }, []);
  return play;
}

/**
 * A review's entrance plays once per page view (the same rule as the job's Overview): the module-level set
 * remembers which reviews already played, and the decision is taken on the first render for a key and kept.
 */
const played = new Set<string>();

function useEntrance(key: string | null): boolean {
  const decided = useRef<{ key: string | null; play: boolean } | null>(null);
  if (decided.current?.key !== key) decided.current = { key, play: !!key && !played.has(key) };
  useEffect(() => {
    if (key) played.add(key);
  }, [key]);
  return decided.current.play;
}

const fadeClass = (play: boolean) => (play ? "ai-fade" : "");
const fadeStyle = (play: boolean, ms: number): CSSProperties | undefined => (play ? { animationDelay: `${ms}ms` } : undefined);

/** When the body's words start fading in, after the lead sentence. */
const BODY_MS = 160;

/** "5 minutes ago", "2 days ago" (the same wording as the job's Overview). */
function timeAgo(iso: string, now = Date.now()): string {
  const secs = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  for (const [unit, size] of units) if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  return "just now";
}

/** The verdict's first sentence (the lead) and the rest (the body). */
function splitLead(text: string): { lead: string; rest: string } {
  const m = text.match(/^([\s\S]*?[.!?])(?:\s+([\s\S]*))?$/);
  return m ? { lead: m[1], rest: m[2] ?? "" } : { lead: text, rest: "" };
}

export type MasterOverviewProps = {
  /** The first-draft and next-step notices, shown above the bullet area. */
  notices: ReactNode;
  /** On phones the selected bullet's comment card is a sheet over the document; then its slot must stay fixed. */
  commentSheet: boolean;
  /** Receives the element the selected bullet's comment card is portalled into. */
  onCommentSlot: (el: HTMLDivElement | null) => void;
  /** The coach panel for the selected entry or bullet. */
  coach: ReactNode;
  /** The AI review of the master resume, or null before the first one. */
  review: MasterAnalysis | null;
  reviewing: boolean;
  /** Why the last review failed (already plain language), "" when none. */
  reviewError: string;
  /** The review can be run now. */
  canReview: boolean;
  /** Run (or re-run) the review. */
  onReview: () => void;
  /** The weakest bullets of the review, weakest first. */
  weakest: { id: string; text: string; rating: "weak" | "ok"; note: string }[];
  /** Select a bullet in the document (and open its comment card). */
  onSelectBullet: (id: string) => void;
  /** The selected bullet's open questions, shown in the bullet area. */
  questions: ReactNode;
};

/**
 * The master resume's Overview: what the page is for and the AI review of the master (its verdict and the weakest
 * bullets), the notices, then the bullet area (blank until a bullet is selected). Plain text on a white page, like
 * the job's Overview.
 */
export function MasterOverview({
  notices,
  commentSheet,
  onCommentSlot,
  coach,
  review,
  reviewing,
  reviewError,
  canReview,
  onReview,
  weakest,
  onSelectBullet,
  questions,
}: MasterOverviewProps) {
  const play = useIntro();
  const reviewPlay = useEntrance(review?.analyzed_at ? `master:${review.analyzed_at}` : null);
  const parts = review ? splitLead(review.verdict) : null;
  const weakMs = (parts?.rest ? flowEndMs(parts.rest, BODY_MS) : BODY_MS) + 80;

  return (
    <div>
      <div className={`flex items-center justify-between gap-3 ${fadeClass(play)}`} style={fadeStyle(play, 0)}>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Master resume</h1>
        <button
          type="button"
          onClick={onReview}
          disabled={!canReview || reviewing}
          aria-label={review ? "Re-analyze: run the review again" : "Review: run the review"}
          title={review ? "Run the review again" : "Run the review of your master resume"}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted transition-colors enabled:hover:bg-fg/[0.05] enabled:hover:text-fg disabled:cursor-default disabled:opacity-40"
        >
          <RefreshIcon className="size-[14px]" />
          {review ? "Re-analyze" : "Review"}
        </button>
      </div>
      <p className={`mt-2 text-[15px] text-muted ${fadeClass(play)}`} style={fadeStyle(play, 60)}>
        Every job you add gets its own tailored copy of this resume. The review judges what you have written; click any bullet to improve it.
      </p>

      {/* The review: a loader where the verdict will appear, then the verdict, the time, and the weakest bullets. */}
      <div className="mt-8 space-y-3">
        {reviewing && <LoadingState label="Reviewing your resume" />}
        {reviewError && !reviewing && (
          <p role="alert" className="text-[14px]">
            <span className="text-bad">{reviewError}</span>
            {canReview && (
              <>
                {" "}
                <button type="button" className="text-fg underline underline-offset-2" onClick={onReview}>
                  Try again
                </button>
              </>
            )}
          </p>
        )}
        {review && parts && !reviewing && (
          <>
            <p className={`text-[17px] font-semibold leading-snug text-fg ${fadeClass(reviewPlay)}`} style={fadeStyle(reviewPlay, 0)}>
              {parts.lead}
            </p>
            {parts.rest && <FlowText text={parts.rest} animate={reviewPlay} start={BODY_MS} className="text-[15px] leading-relaxed text-fg" />}
            {review.analyzed_at && (
              <p className="text-[13px] text-muted" title={new Date(review.analyzed_at).toLocaleString()}>
                Reviewed {timeAgo(review.analyzed_at)}
              </p>
            )}
          </>
        )}
      </div>

      {review && !reviewing && (
        <section className={`mt-7 ${fadeClass(reviewPlay)}`} style={fadeStyle(reviewPlay, weakMs)} aria-labelledby="weakest-heading">
          <h2 id="weakest-heading" className="mb-1 text-[13px] font-medium text-muted">
            Weakest bullets
          </h2>
          {weakest.length > 0 ? (
            <ol role="list" className="-mx-3 list-none space-y-0.5">
              {weakest.map((item, i) => (
                <li key={item.id} className={fadeClass(reviewPlay)} style={fadeStyle(reviewPlay, weakMs + i * 60)}>
                  <WeakBullet item={item} onSelect={() => onSelectBullet(item.id)} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[15px] text-muted">No weak bullets. Nice work.</p>
          )}
        </section>
      )}

      {notices && <div className="mt-10 space-y-6">{notices}</div>}

      {/* The bullet area. Phones: the comment card is a sheet over the document while the Resume tab shows (fixed),
          otherwise it sits here like everything else. */}
      {/* Working in here (the card, questions, coach) keeps the bullet selected, so the card doesn't close and shift the panel mid-click. */}
      <div data-doc-keep-selection className="mt-12 space-y-10">
        <div
          ref={onCommentSlot}
          className={`empty:hidden ${
            commentSheet
              ? "max-lg:visible max-lg:fixed max-lg:inset-x-2 max-lg:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:max-h-[45dvh] max-lg:overflow-y-auto max-lg:rounded-lg max-lg:shadow-lg"
              : ""
          }`}
        />
        {questions}
        {coach}
      </div>
    </div>
  );
}

/** One weakest bullet: a full-width button named by the bullet's text, described by its note. */
function WeakBullet({ item, onSelect }: { item: MasterOverviewProps["weakest"][number]; onSelect: () => void }) {
  const noteId = useId();
  const weak = item.rating === "weak";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={item.text}
      aria-describedby={item.note ? noteId : undefined}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-fg/[0.04]"
    >
      <span aria-hidden className={`mt-[7px] size-[7px] shrink-0 rounded-full ${weak ? "bg-bad" : "bg-ok"}`} />
      <span className="min-w-0">
        <span className="line-clamp-2 block text-[14px] text-fg">{item.text}</span>
        {item.note && (
          <span id={noteId} className="mt-0.5 line-clamp-2 block text-[13px] text-muted">
            <span className="sr-only">{weak ? "Weak. " : "Okay. "}</span>
            {item.note}
          </span>
        )}
      </span>
    </button>
  );
}
