-- Remember that an application reached the interview stage, even if it later ends in Rejected.
alter table public.jobs add column if not exists reached_interview boolean not null default false;
update public.jobs set reached_interview = true where status in ('interview', 'offer');
