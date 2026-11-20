-- AI limits as numbers you can edit per user in the Supabase Table Editor (table ai_quotas):
--   heavy_limit / heavy_remaining / heavy_resets_at  = analyses (job analyses, re-analyses, imports, drafts), per 24 hours
--   light_limit / light_remaining / light_resets_at  = quick AI actions (coaching, cover letters, job details), per hour
-- Each AI call takes one from *_remaining. The window starts at the first call; when *_resets_at passes, the next
-- call refills *_remaining to *_limit. Edit *_remaining to give someone more (or fewer) right now; edit *_limit to
-- change their total. *_limit = 0 turns that kind of AI off for them. New users get a row automatically, using the
-- column defaults (change a default here to change it for new users).
-- Replaces the rolling-window count of 0004 and the admin functions of 0007. Safe to re-run, with or without 0007.
-- Run it after 0004 and 0007 (re-running either of those later restores their older functions; then re-run this one).

create table if not exists public.ai_quotas (
  user_id uuid primary key references auth.users on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.ai_quotas add column if not exists email text not null default '';
alter table public.ai_quotas add column if not exists heavy_limit int;
alter table public.ai_quotas add column if not exists heavy_remaining int;
alter table public.ai_quotas add column if not exists heavy_resets_at timestamptz;
alter table public.ai_quotas add column if not exists light_limit int;
alter table public.ai_quotas add column if not exists light_remaining int;
alter table public.ai_quotas add column if not exists light_resets_at timestamptz;

update public.ai_quotas set heavy_limit = coalesce(heavy_limit, 10), light_limit = coalesce(light_limit, 120);
update public.ai_quotas set heavy_remaining = coalesce(heavy_remaining, heavy_limit),
                            light_remaining = coalesce(light_remaining, light_limit);
alter table public.ai_quotas alter column heavy_limit set default 10;
alter table public.ai_quotas alter column heavy_limit set not null;
alter table public.ai_quotas alter column light_limit set default 120;
alter table public.ai_quotas alter column light_limit set not null;
alter table public.ai_quotas alter column heavy_remaining set not null;
alter table public.ai_quotas alter column light_remaining set not null;
alter table public.ai_quotas drop constraint if exists ai_quotas_heavy_limit_check;
alter table public.ai_quotas drop constraint if exists ai_quotas_light_limit_check;
alter table public.ai_quotas drop constraint if exists ai_quotas_limits_check;
alter table public.ai_quotas add constraint ai_quotas_limits_check
  check (heavy_limit >= 0 and light_limit >= 0 and heavy_remaining >= 0 and light_remaining >= 0);

alter table public.ai_quotas enable row level security;
drop policy if exists "read own ai quota" on public.ai_quotas;
create policy "read own ai quota" on public.ai_quotas for select to authenticated
  using ((select auth.uid()) = user_id);
-- No write policies: only the owner edits rows (Table Editor) and the functions below.

-- A new row starts full: remaining = limit unless given; email filled from auth.users.
-- Edits made in the Table Editor take effect as you'd expect:
--   lowering a *_limit caps *_remaining at it (so 0 turns that AI off right away);
--   editing a *_remaining after its window has passed restarts the window, so the next call doesn't refill over it.
create or replace function public.ai_quotas_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.heavy_remaining := coalesce(new.heavy_remaining, new.heavy_limit);
  new.light_remaining := coalesce(new.light_remaining, new.light_limit);
  if tg_op = 'UPDATE' then
    if new.heavy_limit is distinct from old.heavy_limit then
      new.heavy_remaining := least(new.heavy_remaining, new.heavy_limit);
    end if;
    if new.light_limit is distinct from old.light_limit then
      new.light_remaining := least(new.light_remaining, new.light_limit);
    end if;
    if new.heavy_remaining is distinct from old.heavy_remaining and new.heavy_resets_at is not distinct from old.heavy_resets_at
       and new.heavy_resets_at is not null and new.heavy_resets_at <= now() then
      new.heavy_resets_at := null;
    end if;
    if new.light_remaining is distinct from old.light_remaining and new.light_resets_at is not distinct from old.light_resets_at
       and new.light_resets_at is not null and new.light_resets_at <= now() then
      new.light_resets_at := null;
    end if;
  end if;
  if new.email = '' then
    new.email := coalesce((select u.email from auth.users u where u.id = new.user_id), '');
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ai_quotas_fill on public.ai_quotas;
create trigger ai_quotas_fill before insert or update on public.ai_quotas
  for each row execute function public.ai_quotas_fill();

-- Every account gets a row: existing ones now, new ones when they're created.
insert into public.ai_quotas (user_id, email)
select u.id, coalesce(u.email, '') from auth.users u
on conflict (user_id) do nothing;

create or replace function public.ai_quotas_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ai_quotas (user_id, email) values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists ai_quotas_new_user on auth.users;
create trigger ai_quotas_new_user after insert on auth.users
  for each row execute function public.ai_quotas_new_user();

-- Reserve one AI call: same signature as 0004 (p_limit is no longer used; the row's limit is). Locks the user's
-- row, refills it if its window has passed, takes one, and logs a pending ai_usage row (for token counts).
-- Returns the ai_usage id, or null when nothing is left (or nobody is signed in).
create or replace function public.reserve_ai_call(p_action text, p_weight text, p_limit int, p_window interval)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  q public.ai_quotas%rowtype;
  v_id uuid;
begin
  if v_uid is null or p_weight not in ('heavy', 'light') then
    return null;
  end if;
  insert into public.ai_quotas (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into q from public.ai_quotas where user_id = v_uid for update;

  if p_weight = 'heavy' then
    if q.heavy_resets_at is not null and now() >= q.heavy_resets_at then
      q.heavy_remaining := q.heavy_limit;
      q.heavy_resets_at := null;
    end if;
    if q.heavy_limit <= 0 or q.heavy_remaining <= 0 then
      update public.ai_quotas set heavy_remaining = q.heavy_remaining, heavy_resets_at = q.heavy_resets_at
       where user_id = v_uid;
      return null;
    end if;
    update public.ai_quotas
       set heavy_remaining = q.heavy_remaining - 1,
           heavy_resets_at = coalesce(q.heavy_resets_at, now() + p_window)
     where user_id = v_uid;
  else
    if q.light_resets_at is not null and now() >= q.light_resets_at then
      q.light_remaining := q.light_limit;
      q.light_resets_at := null;
    end if;
    if q.light_limit <= 0 or q.light_remaining <= 0 then
      update public.ai_quotas set light_remaining = q.light_remaining, light_resets_at = q.light_resets_at
       where user_id = v_uid;
      return null;
    end if;
    update public.ai_quotas
       set light_remaining = q.light_remaining - 1,
           light_resets_at = coalesce(q.light_resets_at, now() + p_window)
     where user_id = v_uid;
  end if;

  insert into public.ai_usage (user_id, action, weight, status)
  values (v_uid, left(coalesce(p_action, ''), 64), p_weight, 'pending')
  returning id into v_id;
  return v_id;
end $$;

-- Record how a reserved call ended (same signature as 0004). A failed call gives its use back.
create or replace function public.finish_ai_call(
  p_id uuid, p_status text, p_prompt int, p_output int, p_total int, p_model text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_weight text;
  v_failed boolean := p_status is distinct from 'ok';
begin
  update public.ai_usage
     set status = case when v_failed then 'failed' else 'ok' end,
         prompt_tokens = greatest(coalesce(p_prompt, 0), 0),
         output_tokens = greatest(coalesce(p_output, 0), 0),
         total_tokens = greatest(coalesce(p_total, 0), 0),
         model = left(coalesce(p_model, ''), 80)
   where id = p_id
     and user_id = (select auth.uid())
     and status = 'pending'
  returning weight into v_weight;
  if v_failed and v_weight is not null then
    update public.ai_quotas
       -- Only inside a running window: once it has passed, the next call refills anyway (and a refund then
       -- would look like a manual edit to ai_quotas_fill and cancel that refill).
       set heavy_remaining = case when v_weight = 'heavy' and heavy_remaining < heavy_limit
                                   and (heavy_resets_at is null or heavy_resets_at > now())
                                  then heavy_remaining + 1 else heavy_remaining end,
           light_remaining = case when v_weight = 'light' and light_remaining < light_limit
                                   and (light_resets_at is null or light_resets_at > now())
                                  then light_remaining + 1 else light_remaining end
     where user_id = (select auth.uid());
  end if;
end $$;

revoke all on function public.reserve_ai_call(text, text, int, interval) from public, anon;
revoke all on function public.finish_ai_call(uuid, text, int, int, int, text) from public, anon;
grant execute on function public.reserve_ai_call(text, text, int, interval) to authenticated;
grant execute on function public.finish_ai_call(uuid, text, int, int, int, text) to authenticated;
revoke all on function public.ai_quotas_fill() from public, anon, authenticated;
revoke all on function public.ai_quotas_new_user() from public, anon, authenticated;

drop function if exists public.admin_set_ai_quota(uuid, text, int, int, int, interval);
drop function if exists public.admin_ai_quota_status(int, int, interval, interval);
