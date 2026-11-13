/**
 * Calendar dates (YYYY-MM-DD) in the user's local time zone. Deadlines, applied dates and follow-ups
 * are days on a calendar, not instants, so never derive them from `toISOString()` (UTC): in the US
 * evening that is already tomorrow.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's date in the user's time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `date` (YYYY-MM-DD) plus `days` calendar days. DST-safe (works on calendar fields, not milliseconds). */
export function addDays(date: string, days: number) {
  return localToday(new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + days));
}

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative when overdue. */
export function daysUntil(date: string, today = localToday()) {
  const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((ms(date) - ms(today)) / 86400000);
}

/** Days after applying that a follow-up is due. */
export const FOLLOW_UP_DAYS = 10;

/** Marking a job Applied sets today's (local) date and a follow-up 10 days out. */
export function applyDates(now = new Date()) {
  const today = localToday(now);
  return { date_applied: today, follow_up_date: addDays(today, FOLLOW_UP_DAYS) };
}

/** "Nov 20" for a YYYY-MM-DD date (read-only display). */
export function shortDate(date: string) {
  const d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
