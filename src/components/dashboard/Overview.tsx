import type { Job } from "@/lib/types";
import { SUBMITTED_STATUSES } from "@/lib/outcomes";
import { inProgress } from "@/lib/progress";
import { ChatIcon, ClockIcon, PencilIcon, SendIcon } from "../icons";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Good morning", from the viewer's clock (rendered after load, so it can't mismatch the server). */
function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** One plain sentence on where things stand. */
function summary(total: number, todo: number, due: number, closing: number) {
  if (!total) return "Add your first job to start tailoring your resume for it.";
  const bits: string[] = [];
  if (due) bits.push(`${plural(due, "follow-up")} due`);
  if (closing) bits.push(`${plural(closing, "deadline")} this week`);
  if (bits.length) return `${bits.join(" and ")}.`;
  if (todo) return `${plural(todo, "job")} waiting to be tailored.`;
  return "Everything is up to date.";
}

/** Greeting, one sentence of status, and today's date. */
export function Greeting({ jobs, due, closing }: { jobs: Job[]; due: number; closing: number }) {
  const now = new Date();
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">{greeting(now)}</h1>
        <p className="mt-1.5 text-sm text-muted">{summary(jobs.length, inProgress(jobs).length, due, closing)}</p>
      </div>
      <p className="hidden shrink-0 pt-2 text-sm text-muted sm:block">
        {now.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
      </p>
    </header>
  );
}

/** Four numbers between hairlines: what to tailor, what's sent, interviews, and what needs you. */
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
  return (
    <section
      aria-label="Overview"
      className="grid grid-cols-2 gap-y-5 border-y border-border py-6 lg:grid-cols-4 lg:divide-x lg:divide-border"
    >
      {stats.map((s) => (
        <div key={s.label} className="flex items-center gap-3.5 lg:px-6 lg:first:pl-0">
          <span className="icon-chip">
            <s.Icon />
          </span>
          <div>
            <p className="text-sm font-medium">{s.label}</p>
            <p className="text-lg font-semibold tabular-nums">{s.value}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
