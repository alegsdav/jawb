-- Job Pipeline schema. Every row belongs to the signed-in user; RLS enforces it.

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null default 'Master resume',
  is_master boolean not null default false,
  job_id uuid,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  company text not null default '',
  title text not null default '',
  location text not null default '',
  url text not null default '',
  description text not null default '',
  status text not null default 'to_apply'
    check (status in ('to_apply','applied','interview','offer','rejected','skipped')),
  date_applied date,
  follow_up_date date,
  notes text not null default '',
  analysis jsonb,
  cover_letter text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.resumes
  add constraint resumes_job_fk foreign key (job_id) references public.jobs(id) on delete cascade;

create table public.bullets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  source text not null default '',      -- e.g. "Ellis Chi, CPA" or "Badminton queue site"
  text text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create unique index resumes_one_master_per_user on public.resumes(user_id) where is_master;
create unique index resumes_one_per_job on public.resumes(job_id) where job_id is not null;
create index jobs_user_idx on public.jobs(user_id, created_at desc);
create index bullets_user_idx on public.bullets(user_id, created_at desc);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger resumes_touch before update on public.resumes
  for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

alter table public.resumes enable row level security;
alter table public.jobs enable row level security;
alter table public.bullets enable row level security;

create policy "own resumes" on public.resumes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own jobs" on public.jobs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own bullets" on public.bullets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
