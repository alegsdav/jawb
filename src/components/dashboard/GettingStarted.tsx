"use client";

import Link from "next/link";
import { CheckIcon, SparkIcon } from "../icons";
import { Panel, PanelHeader } from "./ui";

type StepState = "done" | "current" | "upcoming";

const STEPS: { title: string; body: string; state: StepState }[] = [
  { title: "Master resume ready", body: "Your resume is saved. Every job gets its own tailored copy.", state: "done" },
  { title: "Add your first job", body: "Paste a job link or description. Greenhouse, Lever and Ashby links are read for you.", state: "current" },
  { title: "Review AI suggestions", body: "See your fit, then accept or reject suggested rewrites, one bullet at a time.", state: "upcoming" },
  { title: "Apply and track it", body: "Mark it Applied to save a copy of what you sent; we'll remind you to follow up.", state: "upcoming" },
];

/** Jump to the add-job box and focus it (no smooth scroll when the viewer prefers reduced motion). */
function focusAddJob() {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.querySelector<HTMLElement>("#add-job")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  document.querySelector<HTMLTextAreaElement>("#add-job textarea")?.focus();
}

/** A marker: a check on green for done, a bordered number for the current step, a grey number for the rest. */
function Marker({ state, n }: { state: StepState; n: number }) {
  if (state === "done")
    return (
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-tint-green text-tint-green-fg">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  if (state === "current")
    return (
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-fg bg-surface text-[12px] font-semibold text-fg">
        {n}
      </span>
    );
  return (
    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-medium text-muted">
      {n}
    </span>
  );
}

/**
 * The first-run panel for a brand-new account (no jobs yet): four steps from resume to a tracked application,
 * with the current step's action. Replaces the empty In progress and All applications panels.
 */
export function GettingStarted() {
  return (
    <Panel aria-labelledby="getting-started-heading" className="space-y-4">
      <PanelHeader icon={<SparkIcon />} tint="violet" title="Get started" id="getting-started-heading" />
      <div className="space-y-1">
        <p className="text-[13px] text-muted">Four steps from resume to your first tailored application.</p>
      </div>
      <ol className="list-none">
        {STEPS.map((s, i) => {
          const last = i === STEPS.length - 1;
          return (
            <li key={s.title} className={`relative flex flex-wrap items-start gap-x-3 gap-y-2 ${last ? "" : "pb-5"}`}>
              {!last && <span aria-hidden className="absolute left-[13px] top-7 bottom-0 w-0.5 bg-border" />}
              <div className="flex min-w-0 grow basis-[calc(100%-2.5rem)] items-start gap-3 sm:basis-auto">
                <div className="relative shrink-0">
                  <Marker state={s.state} n={i + 1} />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className={`text-[14px] font-medium ${s.state === "upcoming" ? "text-muted" : ""}`}>
                    <span className="sr-only">{s.state === "done" ? "Done: " : s.state === "current" ? "Next: " : ""}</span>
                    {s.title}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted">{s.body}</p>
                </div>
              </div>
              {s.state === "done" && (
                <div className="ml-10 shrink-0 sm:ml-0">
                  <Link href="/resume" className="text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline">
                    Edit
                  </Link>
                </div>
              )}
              {s.state === "current" && (
                <div className="ml-10 shrink-0 sm:ml-0">
                  <button type="button" className="btn btn-sm min-h-9 sm:min-h-0 whitespace-nowrap" onClick={focusAddJob}>
                    Add a job
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
