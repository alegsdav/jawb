"use client";

import { STATUS_DOT } from "@/components/StatusSelect";
import { TailoringOutcomes } from "@/components/OutcomeStats";
import { STATUSES, type Job } from "@/lib/types";
import { ChartIcon } from "../icons";
import { Panel, PanelHeader, TINT } from "./ui";

/**
 * Where every application stands: a stacked bar and legend of job counts by status, then whether tailoring
 * helps (interview rate of tailored vs untailored applications). Shows a designed empty state with no jobs.
 */
export function PipelineCard({ jobs }: { jobs: Job[] }) {
  const rows = STATUSES.map(({ value, label }) => ({
    value,
    label,
    n: jobs.reduce((k, j) => (j.status === value ? k + 1 : k), 0),
  })).filter((r) => r.n > 0);

  return (
    <Panel className="space-y-4">
      <PanelHeader id="pipeline-heading" icon={<ChartIcon />} tint="blue" title="Pipeline" count={jobs.length} />

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span aria-hidden className={`inline-grid h-10 w-10 place-items-center rounded-xl ${TINT.blue} [&_svg]:h-5 [&_svg]:w-5`}>
            <ChartIcon />
          </span>
          <p className="pt-1 text-[14px] font-semibold tracking-tight">No applications yet</p>
          <p className="text-[13px] text-muted">Your pipeline fills in as you add and apply to jobs.</p>
        </div>
      ) : (
        <>
          <div>
            <div
              role="img"
              aria-label={`Pipeline: ${rows.map((r) => `${r.n} ${r.label.toLowerCase()}`).join(", ")}`}
              className="flex h-2.5 overflow-hidden rounded-full"
            >
              {rows.map((r) => (
                <span
                  key={r.value}
                  aria-hidden
                  className="min-w-[6px] rounded-full"
                  style={{ flex: `${r.n} 1 0`, background: STATUS_DOT[r.value] }}
                  title={`${r.label}: ${r.n}`}
                />
              ))}
            </div>
            <ul className="mt-3 space-y-2 text-[13px]">
              {rows.map((r) => (
                <li key={r.value} className="flex items-center gap-2.5">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_DOT[r.value] }} />
                  <span className="min-w-0 flex-1 text-muted">{r.label}</span>
                  <span className="font-medium tabular-nums">{r.n}</span>
                </li>
              ))}
            </ul>
          </div>

          {jobs.some((j) => j.submitted_at) && (
            <div className="border-t border-border pt-4">
              <TailoringOutcomes jobs={jobs} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
