-- Apply only to the reviewed, current deployment. Does not replace evidence routines.
begin;
create schema if not exists signforth_private;
revoke all on schema signforth_private from public, anon, authenticated;

create table signforth_private.request_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits integer not null check (hits > 0)
);
create index request_limits_expiry on signforth_private.request_limits(window_start);
alter table signforth_private.request_limits enable row level security;
revoke all on signforth_private.request_limits from public, anon, authenticated;

-- Separate RPC transaction: rejected/failed business operations cannot roll this back.
-- Fixed one-minute windows; budgets are server-owned, never supplied by callers.
create function public.signforth_consume_client_limit(p_kind text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := statement_timestamp();
  v_start timestamptz := date_trunc('minute', v_now);
  v_retry integer := greatest(1, ceil(extract(epoch from (v_start + interval '1 minute' - v_now)))::integer);
  v_budget integer;
  v_project_budget integer;
  v_hits integer;
  v_bucket text;
begin
  if p_kind is null or p_kind not in ('read', 'write')
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid rate-limit request';
  end if;
  v_budget := case when p_kind = 'read' then 120 else 10 end;
  v_project_budget := case when p_kind = 'read' then 60000 else 3000 end;

  -- Bounded opportunistic cleanup keeps rotating-token storage short-lived.
  -- Two minutes retains the active window plus boundary margin; also schedule idle cleanup.
  delete from signforth_private.request_limits where bucket in (
    select bucket from signforth_private.request_limits
    where window_start < v_now - interval '2 minutes'
    order by window_start limit 100 for update skip locked
  );

  foreach v_bucket in array array['project:' || p_kind, p_kind || ':' || p_token_hash] loop
    insert into signforth_private.request_limits as limits(bucket, window_start, hits)
    values (v_bucket, v_start, 1)
    on conflict (bucket) do update set
      window_start = greatest(limits.window_start, excluded.window_start),
      hits = case when limits.window_start < excluded.window_start then 1 else limits.hits + 1 end
    where limits.window_start < excluded.window_start
       or limits.hits < case when v_bucket = 'project:' || p_kind then v_project_budget else v_budget end
    returning hits into v_hits;
    if not found then
      return jsonb_build_object('allowed', false, 'retry_after', v_retry);
    end if;
  end loop;
  return jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;
revoke all on function public.signforth_consume_client_limit(text, text) from public, anon, authenticated;
grant execute on function public.signforth_consume_client_limit(text, text) to service_role;

create function public.signforth_cleanup_client_limits()
returns void language sql security definer set search_path = '' as $$
  delete from signforth_private.request_limits where window_start < clock_timestamp() - interval '2 minutes';
$$;
revoke all on function public.signforth_cleanup_client_limits() from public, anon, authenticated;
grant execute on function public.signforth_cleanup_client_limits() to service_role;

-- Gateway calls use the service role. The three bodies and signatures are unchanged.
grant execute on function public.get_order_for_signing(uuid) to service_role;
grant execute on function public.fieldsign_get_link_state(uuid) to service_role;
grant execute on function public.fieldsign_submit_client_response_v2(uuid, text, text, uuid) to service_role;
commit;
