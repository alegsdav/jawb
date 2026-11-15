-- Invite-only sign-up and per-user AI usage limits. Safe to re-run.
--
-- invite_codes and signup_attempts are touched only by the server with the service-role key:
-- RLS is on and there are no policies, so the public anon key (and signed-in users) can't read or
-- change them. ai_usage rows are written only through the two security-definer functions below.

-- ---------- invite codes ----------

create table if not exists public.invite_codes (
  code text primary key,
  kind text not null check (kind in ('single', 'reusable')),
  max_uses int not null default 1 check (max_uses >= 1),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint invite_single_is_one_use check (kind <> 'single' or max_uses = 1)
);
alter table public.invite_codes enable row level security;

-- Failed invite-code attempts, for throttling by (hashed) IP address.
create table if not exists public.signup_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists signup_attempts_ip_idx on public.signup_attempts(ip_hash, created_at desc);
alter table public.signup_attempts enable row level security;

-- Redeem one use of a code in a single conditional UPDATE: only while uses < max_uses and not expired.
-- Two people racing for the last use can't both win. Returns true when a use was taken.
create or replace function public.redeem_invite(p_code text) returns boolean
language sql security definer set search_path = '' as $$
  with taken as (
    update public.invite_codes
       set uses = uses + 1
     where code = p_code
       and uses < max_uses
       and (expires_at is null or expires_at > now())
    returning 1
  )
  select exists (select 1 from taken);
$$;

-- Give a use back (account creation failed after the code was redeemed).
create or replace function public.release_invite(p_code text) returns void
language sql security definer set search_path = '' as $$
  update public.invite_codes set uses = uses - 1 where code = p_code and uses > 0;
$$;

revoke all on function public.redeem_invite(text) from public, anon, authenticated;
revoke all on function public.release_invite(text) from public, anon, authenticated;
grant execute on function public.redeem_invite(text) to service_role;
grant execute on function public.release_invite(text) to service_role;

-- ---------- AI usage ----------

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  action text not null,
  weight text not null check (weight in ('heavy', 'light')),
  model text not null default '',
  prompt_tokens int not null default 0,
  output_tokens int not null default 0,
  total_tokens int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'ok', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage(user_id, created_at);
alter table public.ai_usage enable row level security;

drop policy if exists "read own ai usage" on public.ai_usage;
create policy "read own ai usage" on public.ai_usage for select to authenticated
  using ((select auth.uid()) = user_id);
-- No insert/update/delete policies: rows change only through the functions below.

-- Reserve one AI call for the signed-in user: count their pending + ok calls of this weight in the
-- window and insert a pending row only if they're under the limit. A per-user, per-weight advisory
-- lock makes parallel requests take turns, so they can't all see "9 of 10" and go over the cap.
-- Returns the new row's id, or null when the limit is reached (or nobody is signed in).
create or replace function public.reserve_ai_call(p_action text, p_weight text, p_limit int, p_window interval)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_used int;
  v_id uuid;
begin
  if v_uid is null or p_weight not in ('heavy', 'light') or p_limit is null or p_limit < 1 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_usage:' || v_uid::text || ':' || p_weight, 0));
  select count(*) into v_used
    from public.ai_usage
   where user_id = v_uid
     and weight = p_weight
     and status in ('pending', 'ok')
     and created_at > now() - p_window;
  if v_used >= p_limit then
    return null;
  end if;
  insert into public.ai_usage (user_id, action, weight, status)
  values (v_uid, left(coalesce(p_action, ''), 64), p_weight, 'pending')
  returning id into v_id;
  return v_id;
end $$;

-- Record how a reserved call ended. Only the caller's own pending row changes. 'failed' rows don't
-- count toward the limit (a provider outage shouldn't use up the student's calls).
create or replace function public.finish_ai_call(
  p_id uuid, p_status text, p_prompt int, p_output int, p_total int, p_model text default ''
) returns void
language sql security definer set search_path = '' as $$
  update public.ai_usage
     set status = case when p_status = 'ok' then 'ok' else 'failed' end,
         prompt_tokens = greatest(coalesce(p_prompt, 0), 0),
         output_tokens = greatest(coalesce(p_output, 0), 0),
         total_tokens = greatest(coalesce(p_total, 0), 0),
         model = left(coalesce(p_model, ''), 80)
   where id = p_id
     and user_id = (select auth.uid())
     and status = 'pending';
$$;

revoke all on function public.reserve_ai_call(text, text, int, interval) from public, anon;
revoke all on function public.finish_ai_call(uuid, text, int, int, int, text) from public, anon;
grant execute on function public.reserve_ai_call(text, text, int, interval) to authenticated;
grant execute on function public.finish_ai_call(uuid, text, int, int, int, text) to authenticated;
