-- 0011: the one-time AI review of the master resume, stored on the master row (is_master = true).
-- Safe to re-run. The app works without this file: until it runs, the review lives only in the page.
-- RLS on public.resumes already covers the new column (the row's owner only).

alter table public.resumes add column if not exists analysis jsonb;
