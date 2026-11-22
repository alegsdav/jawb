"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import type { Analysis, Fit, Job } from "@/lib/types";
import { fitOf } from "@/lib/fit";
import { SUBMITTED_STATUSES } from "@/lib/outcomes";
import { plural } from "@/lib/facts";
import { DeadlineField } from "../DeadlineField";
import { Menu, MenuItem } from "../Menu";
import { FlowText, flowEndMs } from "../FlowText";

/** Borderless input exactly as wide as its text: a hidden copy sets the width, the input sits over it. */
function FitInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <span className="relative inline-grid max-w-full shrink-0 -mx-[5px]">
      {/* Same font size as the input: phones force fields to 16px (globals.css), so the sizing text does too. */}
      <span aria-hidden className="invisible max-w-full overflow-hidden whitespace-pre border border-transparent px-1 py-0.5 text-[16px] sm:text-[15px]">
        {value || placeholder}
      </span>
      <input
        className="ghost-input absolute inset-0 w-full min-w-0 text-[15px]"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

const TITLE_TEXT = "text-[28px] font-semibold leading-tight tracking-tight";

/**
 * The job title, in the Overview's h1. A long title wraps onto as many lines as it needs: a hidden copy sets
 * the height and the textarea sits over it. Enter doesn't add a line.
 */
function TitleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <h1 className="relative -mx-[5px] min-w-0">
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

const LEAD: Record<Fit, string> = {
  strong: "You're a strong candidate for this role.",
  possible: "You have a good chance, but you're missing a few important things.",
  stretch: "Your resume isn't a close fit for this job yet.",
};

/** When the verdict's words start fading in, and the blocks after it wait for them. */
const VERDICT_MS = 300;

/** The daily analysis limit: retrying can't work until the window reopens, so no Retry for it. */
const ANALYSIS_LIMIT_RE = /^You've used all \d+ of your analyses for the last 24 hours\b|^AI analyses are turned off for your account\./;

/** "5 minutes ago", "2 days ago". */
function timeAgo(iso: string, now = Date.now()): string {
  const secs = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  for (const [unit, size] of units) if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  return "just now";
}

/**
 * Each analysis's entrance plays once per page view: the Overview remounts on every tab switch, and this
 * set (module level) remembers which analyses already played. The decision is taken on the first render
 * for a key and kept, so re-renders don't cut the animation short.
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

export type OverviewProps = {
  job: Job;
  /** Applied and not re-applying: read-only. No analysis actions, no questions. */
  quiet: boolean;
  applied: boolean;
  analysis: Analysis | null;
  analyzing: boolean;
  /** Why the last analysis failed (already plain language). */
  analyzeError: string;
  /** Why analysis can't run yet (no resume loaded, or an empty master). */
  disabledReason?: string;
  /** Suggested edits still waiting (stale ones excluded). */
  pendingCount: number;
  /** Notices (migration hint, errors, applied state, pull-from-master plan), shown above the title. */
  notices: ReactNode;
  /** The quiet status control, shown while the job isn't applied. */
  statusControl: ReactNode;
  onPatch: (p: Partial<Job>) => void;
  onDelete: () => void;
  onAnalyze: () => void;
  onAcceptAll: () => void;
  onOpenPosting: () => void;
  /** On phones the selected bullet's comment card is a sheet over the document; then its slot must stay fixed. */
  commentSheet: boolean;
  /** Receives the element the selected bullet's comment card is portalled into. */
  onCommentSlot: (el: HTMLDivElement | null) => void;
  /** Receives the bullet area, so the page can scroll the panel to it when a bullet is selected. */
  bulletAreaRef: Ref<HTMLDivElement>;
  /** The selected bullet's text: shown at the top of the bullet area (the comment card drops its copy on desktop). */
  selectedText: string | null;
  /** The selected bullet's questions (BulletQuestions), already filtered. */
  questions: ReactNode;
  /** The coach panel for the selected entry or bullet. */
  coach: ReactNode;
};

/**
 * The job's Overview tab: title and company, the fit in one sentence with the verdict, the keywords, then the
 * bullet area (the selected bullet's comment card, its questions, the coach). Plain text on a white page.
 */
export function JobOverview(p: OverviewProps) {
  const { job, analysis: a } = p;
  const fit = fitOf(a);
  const play = useEntrance(a?.analyzed_at ? `${job.id}:${a.analyzed_at}` : null);
  const verdictEnd = a ? flowEndMs(a.verdict, VERDICT_MS) : 0;
  const keywordsMs = verdictEnd + 80;
  const missing = a?.keywords.missing ?? [];
  const matched = a?.keywords.matched ?? [];
  const limit = !!p.analyzeError && ANALYSIS_LIMIT_RE.test(p.analyzeError);

  return (
    <div>
      {p.notices && <div className="space-y-3 empty:hidden pb-8">{p.notices}</div>}

      <div className={fadeClass(play)} style={fadeStyle(play, 0)}>
        <TitleField value={job.title} onChange={(v) => p.onPatch({ title: v })} />
      </div>

      <div className={`mt-2 flex min-w-0 flex-wrap items-center gap-x-1 text-[15px] text-muted ${fadeClass(play)}`} style={fadeStyle(play, 60)}>
        <FitInput value={job.company} placeholder="Company" onChange={(v) => p.onPatch({ company: v })} />
        <span aria-hidden>·</span>
        <FitInput value={job.location} placeholder="Location" onChange={(v) => p.onPatch({ location: v })} />
      </div>

      <div
        className={`mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted ${fadeClass(play)}`}
        style={fadeStyle(play, 120)}
      >
        {!p.applied && p.statusControl}
        {/* Borderless like the status control: a hairline only on hover and focus. */}
        <div className="[&_input]:border-transparent [&_input]:hover:border-border [&_input]:focus:border-fg/40">
          <DeadlineField compact value={job.deadline ?? null} status={job.status} onChange={(v) => p.onPatch({ deadline: v })} />
        </div>
        {SUBMITTED_STATUSES.has(job.status) && (
          <label className="inline-flex items-center gap-2">
            <span>Follow up</span>
            <input
              type="date"
              aria-label="Follow-up date"
              className="ghost-input border-transparent hover:border-border focus:border-fg/40 text-[13px]"
              value={job.follow_up_date ?? ""}
              onChange={(e) => p.onPatch({ follow_up_date: e.target.value || null })}
            />
          </label>
        )}
        {job.url && (
          // Not "Posting": that's also the name of a tab.
          <a href={job.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">
            Open posting ↗
          </a>
        )}
        <Menu
          label="⋯"
          title="More actions"
          buttonClassName="-my-1 rounded-md px-1.5 text-[15px] leading-none text-muted hover:bg-surface-2 hover:text-fg"
        >
          <MenuItem onSelect={p.onAnalyze} disabled={p.analyzing || p.quiet || !!p.disabledReason}>
            {p.analyzing ? "Analyzing…" : a ? "Re-analyze" : "Analyze fit"}
          </MenuItem>
          <MenuItem onSelect={p.onDelete} danger>
            Delete job
          </MenuItem>
        </Menu>
      </div>

      {/* Fit and verdict. */}
      <div className="mt-8 space-y-3">
        {p.quiet && (
          <p className="text-xs text-muted">
            {a ? "From before you applied. " : "No analysis was run before you applied. "}Turn on &ldquo;Keep editing&rdquo; to tailor this copy again.
          </p>
        )}
        {p.analyzing && <p className="animate-pulse text-[13px] text-muted">Reading the posting against your resume…</p>}
        {p.analyzeError && !p.analyzing && !p.quiet && (
          <p role="alert" className="text-[13px]">
            <span className="text-bad">{p.analyzeError}</span>
            {!limit && (
              <>
                {" "}
                <button type="button" className="text-fg underline underline-offset-2" onClick={p.onAnalyze} disabled={!!p.disabledReason}>
                  Try again
                </button>
              </>
            )}
          </p>
        )}
        {a && fit && (
          <p className={`text-[17px] font-medium leading-snug text-fg ${fadeClass(play)}`} style={fadeStyle(play, 220)}>
            {LEAD[fit]}
          </p>
        )}
        {a && <FlowText text={a.verdict} animate={play} start={VERDICT_MS} className="text-[15px] leading-relaxed text-fg" />}
        {a?.analyzed_at && (
          <p className="text-xs text-muted" title={new Date(a.analyzed_at).toLocaleString()}>
            Analyzed {timeAgo(a.analyzed_at)}
            {!p.quiet && p.pendingCount > 0 && (
              <>
                {" · "}
                <button type="button" className="underline underline-offset-2 hover:text-fg" onClick={p.onAcceptAll}>
                  Accept all {plural(p.pendingCount, "suggested edit")}
                </button>
              </>
            )}
          </p>
        )}
        {!a && !p.analyzing && !p.analyzeError && !p.quiet && p.disabledReason && (
          <p className="text-[15px] text-muted">{p.disabledReason}</p>
        )}
        {!a && !p.analyzing && !p.analyzeError && !p.quiet && !p.disabledReason && !job.description.trim() && (
          <p className="text-[15px] text-muted">
            Paste the job description in the{" "}
            <button type="button" className="text-fg underline underline-offset-2" onClick={p.onOpenPosting}>
              Posting tab
            </button>{" "}
            to get an analysis.
          </p>
        )}
      </div>

      {/* Keywords: plain words with a dot, not chips. */}
      {a && (
        <div className={`mt-8 space-y-3 ${fadeClass(play)}`} style={fadeStyle(play, keywordsMs)}>
          <p className="text-[13px] font-medium text-fg">
            Missing from your resume <span className="font-normal text-muted">{missing.length}</span>
          </p>
          {missing.length > 0 ? (
            <>
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {missing.map((k) => (
                  <li key={k} className="flex items-center gap-2 text-[15px] text-fg">
                    <span aria-hidden className="size-1.5 rounded-full bg-bad" />
                    {k}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Add one only if it&apos;s true for you.</p>
            </>
          ) : (
            <p className="text-[13px] text-muted">Your resume already covers the posting&apos;s keywords.</p>
          )}
          {matched.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-[13px] text-muted">
                Already on your resume <span>{matched.length}</span>
              </p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {matched.map((k) => (
                  <li key={k} className="flex items-center gap-2 text-[13px] text-muted">
                    <span aria-hidden className="size-1.5 rounded-full bg-good" />
                    {k}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* The bullet area: blank until a bullet is selected. Phones: the comment card is a sheet over the document
          while the Resume tab shows (fixed), otherwise it sits here like everything else. */}
      <div ref={p.bulletAreaRef} className="mt-12 space-y-10">
        {p.selectedText && <p className="line-clamp-2 text-[13px] text-muted">{p.selectedText.trim() || "Empty bullet"}</p>}
        <div
          ref={p.onCommentSlot}
          className={`empty:hidden ${
            p.commentSheet
              ? "max-lg:visible max-lg:fixed max-lg:inset-x-2 max-lg:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:max-h-[45dvh] max-lg:overflow-y-auto max-lg:rounded-lg max-lg:shadow-lg"
              : ""
          }`}
        />
        {p.questions}
        {p.coach}
      </div>
    </div>
  );
}
