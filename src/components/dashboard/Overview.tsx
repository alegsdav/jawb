import type { Job } from "@/lib/types";
import { SUBMITTED_STATUSES } from "@/lib/outcomes";
import { inProgress } from "@/lib/progress";
import { ChatIcon, ClockIcon, PencilIcon, SendIcon } from "../icons";

/** Numbers between hairlines: what to tailor, what's sent, interviews, and what needs you. Only the non-zero ones; nothing at all when all are zero. */
export function StatStrip({ jobs, attention }: { jobs: Job[]; attention: number }) {
  const todo = inProgress(jobs).length;
  const applied = jobs.filter((j) => SUBMITTED_STATUSES.has(j.status) || j.submitted_at).length;
  const interviews = jobs.filter((j) => j.reached_interview || j.status === "interview" || j.status === "offer").length;
  const stats = [
    { label: "To tailor", value: todo, Icon: PencilIcon },
    { label: "Applied", value: applied, Icon: SendIcon },
    { label: "Interviews", value: interviews, Icon: ChatIcon },
    { label: "Needs you", value: attention, Icon: ClockIcon },
  ];
  const shown = stats.filter((s) => s.value > 0);
  if (!shown.length) return null;
  return (
    <section
      aria-label="Overview"
      className="grid grid-cols-2 gap-y-4 border-y border-border py-4 lg:grid-cols-4 lg:divide-x lg:divide-border"
    >
      {shown.map((s) => (
        <div key={s.label} className="flex items-center gap-3 lg:px-6 lg:first:pl-0">
          <span className="icon-chip h-8 w-8">
            <s.Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs text-muted">{s.label}</p>
            <p className="text-base font-semibold tabular-nums">{s.value}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
