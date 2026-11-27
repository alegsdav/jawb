-- 0010: record how many prompt tokens Gemini served from its context cache (usageMetadata.cachedContentTokenCount).
-- Safe to re-run. The app works without this file: until it runs, cached tokens just aren't stored.

alter table public.ai_usage add column if not exists cached_tokens integer not null default 0;

-- A new argument makes finish_ai_call a different overload, so drop the 0008 signature first
-- (otherwise two overloads would exist and the old one would stay callable).
drop function if exists public.finish_ai_call(uuid, text, int, int, int, text);

-- Same behaviour as 0008 (a failed call gives its use back), plus p_cached. Default 0 keeps old-style calls working.
create or replace function public.finish_ai_call(
  p_id uuid, p_status text, p_prompt int, p_output int, p_total int, p_model text default '', p_cached int default 0
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
         cached_tokens = greatest(coalesce(p_cached, 0), 0),
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

revoke all on function public.finish_ai_call(uuid, text, int, int, int, text, int) from public, anon;
grant execute on function public.finish_ai_call(uuid, text, int, int, int, text, int) to authenticated;
