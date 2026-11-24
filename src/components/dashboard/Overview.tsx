import type { Job } from "@/lib/types";
import { SUBMITTED_STATUSES } from "@/lib/outcomes";
import { inProgress } from "@/lib/progress";
import { ChatIcon, ClockIcon, PencilIcon, SendIcon } from "../icons";
import { TINT, type Tint } from "./ui";

/** "Good morning", from the viewer's clock (rendered after load, so it can't mismatch the server). */
function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The greeting, today's date above it, and an optional one-line summary below. */
export function Greeting({ summary }: { summary?: string }) {
  const now = new Date();
  const today = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <header className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{today}</p>
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{greeting(now)}</h1>
      {summary && <p className="text-[14px] text-muted">{summary}</p>}
    </header>
  );
}

/** Four tinted tiles: what to tailor, what's sent, interviews, and what needs you. Always all four, so zeros read as a state, not a gap. */
export function StatStrip({ jobs, attention }: { jobs: Job[]; attention: number }) {
  const todo = inProgress(jobs).length;
  const applied = jobs.filter((j) => SUBMITTED_STATUSES.has(j.status) || j.submitted_at).length;
  const interviews = jobs.filter((j) => j.reached_interview || j.status === "interview" || j.status === "offer").length;
  const stats: { label: string; value: number; caption: string; Icon: typeof PencilIcon; tint: Tint }[] = [
    { label: "To tailor", value: todo, caption: "Not sent yet", Icon: PencilIcon, tint: "blue" },
    { label: "Applied", value: applied, caption: "Resumes sent", Icon: SendIcon, tint: "violet" },
    { label: "Interviews", value: interviews, caption: "Reached interview", Icon: ChatIcon, tint: "green" },
    { label: "Needs you", value: attention, caption: "Follow-ups & deadlines", Icon: ClockIcon, tint: "orange" },
  ];
  return (
    <section aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className={`rounded-2xl p-4 ${TINT[s.tint]}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/60">
              <s.Icon className="h-4 w-4" />
            </span>
            <p className="text-right text-[11px] font-medium uppercase tracking-wider">{s.label}</p>
          </div>
          <p className="mt-3 text-[28px] font-semibold leading-none tabular-nums text-fg">{s.value}</p>
          <p className="mt-1.5 text-[12px] opacity-80">{s.caption}</p>
        </div>
      ))}
    </section>
  );
}
