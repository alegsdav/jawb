-- Structured facts: one row per true thing about the student, instead of the master resume's
-- content->'facts' string list. Safe to re-run.
--
-- A fact can be linked to the bullet it describes: (resume_id, bullet_id) of the master resume, or of a
-- job's tailored copy when the student coached that bullet on the job's page; entry_id links it to an
-- entry. The app keeps a linked fact's text equal to its bullet's text. When the bullet is emptied or
-- deleted, or its job/resume is deleted, the link is cleared and the fact stays on its own.
-- A fact still containing a [placeholder] is a draft (active = false); the AI only sees active facts.

create table if not exists public.facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  text text not null,
  source text not null default 'manual'
    check (source in ('resume', 'builder', 'answer', 'coaching', 'manual', 'extracted', 'legacy')),
  active boolean not null default true,
  resume_id uuid references public.resumes(id) on delete set null,
  bullet_id text,
  entry_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists facts_user_idx on public.facts(user_id);
create index if not exists facts_resume_idx on public.facts(resume_id) where resume_id is not null;

alter table public.facts enable row level security;
drop policy if exists "own facts" on public.facts;
create policy "own facts" on public.facts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop trigger if exists facts_touch on public.facts;
create trigger facts_touch before update on public.facts
  for each row execute function public.touch_updated_at();

-- When the linked resume is deleted (a job and its tailored copy deleted), "on delete set null" clears
-- resume_id; clear bullet_id with it so the fact becomes a plain standalone fact.
create or replace function public.facts_clear_bullet_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.resume_id is null then new.bullet_id = null; end if;
  return new;
end $$;
drop trigger if exists facts_unlink on public.facts;
create trigger facts_unlink before insert or update on public.facts
  for each row execute function public.facts_clear_bullet_link();

-- Copy every existing master-resume fact into a row (source 'legacy'). Case/whitespace-insensitive
-- duplicates collapse to one, and re-running adds nothing new. Facts with a [placeholder] are drafts.
-- resumes.content->'facts' is left as it is; the app no longer reads or writes it.
insert into public.facts (user_id, text, source, active, created_at)
select distinct on (r.user_id, lower(regexp_replace(btrim(f.value), '\s+', ' ', 'g')))
       r.user_id,
       btrim(f.value),
       'legacy',
       btrim(f.value) !~ '\[[^]\n]+\]',
       r.created_at
  from public.resumes r
 cross join lateral jsonb_array_elements(
       case when jsonb_typeof(r.content -> 'facts') = 'array' then r.content -> 'facts' else '[]'::jsonb end
     ) as e(item)
 cross join lateral (select e.item #>> '{}' as value) as f
 where r.is_master
   and jsonb_typeof(e.item) = 'string'
   and btrim(f.value) <> ''
   and not exists (
     select 1 from public.facts x
      where x.user_id = r.user_id
        and x.source = 'legacy'
        and lower(regexp_replace(btrim(x.text), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(f.value), '\s+', ' ', 'g'))
   )
 order by r.user_id, lower(regexp_replace(btrim(f.value), '\s+', ' ', 'g'));

comment on column public.resumes.content is
  'Resume JSON. content->facts is legacy (copied to public.facts by migration 0005) and no longer read or written.';
