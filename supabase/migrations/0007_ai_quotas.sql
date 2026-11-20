-- Per-user AI limits that override the env defaults, plus admin-only functions to set a user's
-- limit and how many calls they have left. Safe to re-run.

create table if not exists public.ai_quotas (
  user_id uuid primary key references auth.users on delete cascade,
  heavy_limit int check (heavy_limit is null or heavy_limit >= 0),   -- null = env default
  light_limit int check (light_limit is null or light_limit >= 0),   -- null = env default
  updated_at timestamptz not null default now()
);
alter table public.ai_quotas enable row level security;
drop policy if exists "read own ai quota" on public.ai_quotas;
create policy "read own ai quota" on public.ai_quotas for select to authenticated
  using ((select auth.uid()) = user_id);
-- No write policies: only the service role (admin page) writes.

-- Rows an admin adjusts away stop counting: allow a 'voided' status.
alter table public.ai_usage drop constraint if exists ai_usage_status_check;
alter table public.ai_usage add constraint ai_usage_status_check
  check (status in ('pending', 'ok', 'failed', 'voided'));

-- ---------- reserve_ai_call: same as 0004, plus the user's own override ----------

-- Same signature and behaviour as 0004, except the limit is the user's ai_quotas value for this weight
-- when they have one (0 means no calls), else the env default passed in as p_limit.
create or replace function public.reserve_ai_call(p_action text, p_weight text, p_limit int, p_window interval)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_override int;
  v_limit int;
  v_used int;
  v_id uuid;
begin
  if v_uid is null or p_weight not in ('heavy', 'light') or p_limit is null or p_limit < 1 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_usage:' || v_uid::text || ':' || p_weight, 0));
  select case when p_weight = 'heavy' then heavy_limit else light_limit end into v_override
    from public.ai_quotas
   where user_id = v_uid;
  v_limit := coalesce(v_override, p_limit);
  select count(*) into v_used
    from public.ai_usage
   where user_id = v_uid
     and weight = p_weight
     and status in ('pending', 'ok')
     and created_at > now() - p_window;
  if v_used >= v_limit then
    return null;
  end if;
  insert into public.ai_usage (user_id, action, weight, status)
  values (v_uid, left(coalesce(p_action, ''), 64), p_weight, 'pending')
  returning id into v_id;
  return v_id;
end $$;

-- ---------- admin functions (service role only) ----------

-- Set one user's limit for one weight (null clears the override back to the env default). With
-- p_remaining, also set how many calls they have left in the window: earlier counted calls are voided,
-- then enough 'admin_adjust' rows are added that counted calls = effective limit - p_remaining.
create or replace function public.admin_set_ai_quota(
  p_user uuid, p_weight text, p_limit int, p_default int, p_remaining int, p_window interval
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_eff int;
  v_remaining int;
  v_pend int;
  v_add int;
begin
  if p_weight not in ('heavy', 'light') then
    raise exception 'weight must be heavy or light';
  end if;
  -- The same per-user, per-weight lock as reserve_ai_call: a call reserved mid-adjustment can't be miscounted.
  perform pg_advisory_xact_lock(hashtextextended('ai_usage:' || p_user::text || ':' || p_weight, 0));

  insert into public.ai_quotas as q (user_id, heavy_limit, light_limit, updated_at)
  values (
    p_user,
    case when p_weight = 'heavy' then p_limit end,
    case when p_weight = 'light' then p_limit end,
    now()
  )
  on conflict (user_id) do update set
    heavy_limit = case when p_weight = 'heavy' then excluded.heavy_limit else q.heavy_limit end,
    light_limit = case when p_weight = 'light' then excluded.light_limit else q.light_limit end,
    updated_at = now();

  if p_remaining is not null then
    v_eff := coalesce(p_limit, p_default);
    v_remaining := least(greatest(p_remaining, 0), v_eff);

    update public.ai_usage
       set status = 'voided'
     where user_id = p_user
       and weight = p_weight
       and status = 'ok'
       and created_at > now() - p_window;

    select count(*)::int into v_pend
      from public.ai_usage
     where user_id = p_user
       and weight = p_weight
       and status = 'pending'
       and created_at > now() - p_window;

    v_add := greatest(v_eff - v_remaining - v_pend, 0);
    if v_add > 0 then
      -- user_id is passed explicitly: the column default auth.uid() is null for the service role.
      insert into public.ai_usage (user_id, action, weight, status)
      select p_user, 'admin_adjust', p_weight, 'ok'
        from generate_series(1, v_add);
    end if;
  end if;
end $$;

-- Each user's limits (override, or the env default when there's none) and calls used in the window.
create or replace function public.admin_ai_quota_status(
  p_heavy_default int, p_light_default int, p_heavy_window interval, p_light_window interval
)
returns table (
  user_id uuid,
  email text,
  heavy_limit int,
  heavy_is_default boolean,
  heavy_used int,
  light_limit int,
  light_is_default boolean,
  light_used int
)
language sql security definer set search_path = '' as $$
  select
    u.id,
    u.email::text,
    coalesce(q.heavy_limit, p_heavy_default),
    q.heavy_limit is null,
    (select count(*)::int from public.ai_usage a
      where a.user_id = u.id and a.weight = 'heavy'
        and a.status in ('pending', 'ok') and a.created_at > now() - p_heavy_window),
    coalesce(q.light_limit, p_light_default),
    q.light_limit is null,
    (select count(*)::int from public.ai_usage a
      where a.user_id = u.id and a.weight = 'light'
        and a.status in ('pending', 'ok') and a.created_at > now() - p_light_window)
  from auth.users u
  left join public.ai_quotas q on q.user_id = u.id
  order by u.email;
$$;

revoke all on function public.reserve_ai_call(text, text, int, interval) from public, anon;
grant execute on function public.reserve_ai_call(text, text, int, interval) to authenticated;

revoke all on function public.admin_set_ai_quota(uuid, text, int, int, int, interval) from public, anon, authenticated;
revoke all on function public.admin_ai_quota_status(int, int, interval, interval) from public, anon, authenticated;
grant execute on function public.admin_set_ai_quota(uuid, text, int, int, int, interval) to service_role;
grant execute on function public.admin_ai_quota_status(int, int, interval, interval) to service_role;
