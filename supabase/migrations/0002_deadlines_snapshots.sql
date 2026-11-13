-- Deadlines and "what I actually sent" snapshots.
alter table public.jobs
  add column if not exists deadline date,
  add column if not exists submitted_resume jsonb,
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_tailored boolean;

create index if not exists jobs_deadline_idx on public.jobs(user_id, deadline);

-- The standalone bullet bank was folded into the master resume ("facts").
-- The table is kept (not dropped) so nothing is lost; the app no longer reads or writes it.
comment on table public.bullets is 'Deprecated: replaced by resumes.content.facts on the master resume.';
