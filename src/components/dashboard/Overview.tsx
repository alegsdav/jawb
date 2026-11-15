import type { Job } from "@/lib/types";
import { SUBMITTED_STATUSES } from "@/lib/outcomes";
import { inProgress } from "@/lib/progress";
import { CalendarIcon, ChatIcon, ClockIcon, PencilIcon, SendIcon } from "../icons";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Good morning", from the viewer's clock (rendered after load, so it can't mismatch the server). */
function greeting(now: Date) {
  const h = now.getHours();
  return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** One plain sentence on where things stand, in the student's own terms. */
function summary(total: number, todo: number, due: number, closing: number) {
  if (!total) return "Add your first job to start tailoring your resume for it.";
  const bits: string[] = [];
  if (due) bits.push(`${plural(due, "follow-up")} due`);
  if (closing) bits.push(`${plural(closing, "deadline")} this week`);
  if (bits.length) return `${bits.join(" and ")}. Start there, then pick up where you left off.`;
  if (todo) return `${plural(todo, "job")} waiting to be tailored. Nothing is overdue.`;
  return "Everything is up to date. Add a job when you find one worth applying to.";
}

/** Greeting row: hello, one sentence of status, and today's date. */
export function Greeting({ jobs, due, closing }: { jobs: Job[]; due: number; closing: number }) {
  const now = new Date();
  const todo = inProgress(jobs).length;
  return (
    <header className="rise flex items-start justify-between gap-4" style={{ ["--i" as string]: 0 }}>
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight">{greeting(now)}</h1>
        <p className="mt-1 text-sm text-muted">{summary(jobs.length, todo, due, closing)}</p>
      </div>
      <div className="hidden shrink-0 items-center gap-3 sm:flex">
        <span className="text-sm text-muted">
          {now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </span>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-muted shadow-[var(--shadow-card)] border border-border">
          <CalendarIcon className="h-[18px] w-[18px]" />
        </span>
      </div>
    </header>
  );
}

type Stat = { label: string; value: number; note: string; Icon: typeof SendIcon; bg: string; fg: string };

/** The four numbers that matter: what to tailor, what's sent, what turned into interviews, what needs you. */
export function StatStrip({ jobs, attention }: { jobs: Job[]; attention: number }) {
  const total = jobs.length;
  const todo = inProgress(jobs).length;
  const applied = jobs.filter((j) => SUBMITTED_STATUSES.has(j.status) || j.submitted_at).length;
  const interviews = jobs.filter((j) => j.reached_interview || j.status === "interview" || j.status === "offer").length;
  const stats: Stat[] = [
    { label: "To tailor", value: todo, note: todo ? "ready to tailor" : "nothing waiting", Icon: PencilIcon, bg: "var(--tint-peach)", fg: "var(--tint-peach-fg)" },
    { label: "Applied", value: applied, note: total ? `of ${plural(total, "job")}` : "no jobs yet", Icon: SendIcon, bg: "var(--tint-blue)", fg: "var(--tint-blue-fg)" },
    {
      label: "Interviews", value: interviews,
      note: applied ? `${Math.round((interviews / applied) * 100)}% of applied` : "after you apply",
      Icon: ChatIcon, bg: "var(--tint-mint)", fg: "var(--tint-mint-fg)",
    },
    { label: "Needs you", value: attention, note: attention ? "follow-ups, deadlines" : "all clear", Icon: ClockIcon, bg: "var(--tint-rose)", fg: "var(--tint-rose-fg)" },
  ];
  return (
    <section
      aria-label="Overview"
      className="rise card grid grid-cols-2 gap-y-5 p-4 sm:p-5 lg:grid-cols-4 lg:gap-y-0 lg:divide-x lg:divide-border"
      style={{ ["--i" as string]: 1 }}
    >
      {stats.map((s) => (
        <div key={s.label} className="flex items-center gap-3 lg:px-5 lg:first:pl-0 lg:last:pr-0">
          <span className="icon-chip" style={{ background: s.bg, color: s.fg }}>
            <s.Icon />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted">{s.label}</p>
            <p className="text-2xl font-bold leading-tight tabular-nums">{s.value}</p>
            <p className="text-xs text-muted">{s.note}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
