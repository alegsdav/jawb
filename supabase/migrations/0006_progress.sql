-- Tailoring progress per job, for the dashboard's "In progress" list (no resume joins needed).
-- Written by the job page's save path: suggestions_total = suggested rewrites in the latest analysis,
-- suggestions_pending = how many of them still wait for a decision. Null = not analyzed yet.
-- Safe to re-run.
alter table public.jobs
  add column if not exists suggestions_total int check (suggestions_total is null or suggestions_total >= 0),
  add column if not exists suggestions_pending int check (suggestions_pending is null or suggestions_pending >= 0);
