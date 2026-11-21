-- Sidebar pins and "recently visited" order, synced across the student's devices. Safe to re-run.
--
-- One row per job the student has opened or pinned. Kept out of public.jobs on purpose: the jobs_touch trigger
-- bumps jobs.updated_at on every update, and the app uses updated_at to detect edits from another device (and
-- the dashboard sorts by it), so recording a visit there would look like an edit.
-- The sidebar orders recent jobs by the later of jobs.updated_at and job_nav.visited_at; pinned jobs
-- (pinned_at not null) are listed first, newest pin first. Deleting a job deletes its row.

create table if not exists public.job_nav (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  visited_at timestamptz,
  pinned_at timestamptz
);
create index if not exists job_nav_user_idx on public.job_nav(user_id);

alter table public.job_nav enable row level security;
drop policy if exists "own job nav" on public.job_nav;
-- A student reads and writes only their own rows, and only for their own jobs.
create policy "own job nav" on public.job_nav for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on public.job_nav to authenticated;

-- Record that the student opened a job, with the database's clock (so a device with a wrong clock can't
-- reorder the list). Runs as the caller, so the policy above applies.
create or replace function public.record_job_visit(p_job uuid) returns timestamptz
language sql security invoker set search_path = '' as $$
  insert into public.job_nav (job_id, visited_at) values (p_job, now())
  on conflict (job_id) do update set visited_at = excluded.visited_at
  returning visited_at;
$$;

-- Pin (p_pinned = true) or unpin a job. Returns the new pinned_at (null when unpinned).
create or replace function public.set_job_pinned(p_job uuid, p_pinned boolean) returns timestamptz
language sql security invoker set search_path = '' as $$
  insert into public.job_nav (job_id, pinned_at) values (p_job, case when p_pinned then now() end)
  on conflict (job_id) do update set pinned_at = excluded.pinned_at
  returning pinned_at;
$$;

revoke execute on function public.record_job_visit(uuid) from public, anon;
revoke execute on function public.set_job_pinned(uuid, boolean) from public, anon;
grant execute on function public.record_job_visit(uuid) to authenticated;
grant execute on function public.set_job_pinned(uuid, boolean) to authenticated;
