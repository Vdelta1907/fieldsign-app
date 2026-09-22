-- Additive dashboard read support. Execute only this migration for this release.
-- No signed records, evidence, policies or existing function bodies are changed.
begin;
create index if not exists signforth_orders_dashboard_page_idx
  on public.orders (owner_id, created_at desc, id desc) where archived_at is null;

create function public.signforth_dashboard_page(
  p_category text default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  v_owner uuid := auth.uid();
  v_summary jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_cursor jsonb := null;
  v_selected_count bigint := 0;
begin
  if v_owner is null then raise exception 'Sign in to load the dashboard'; end if;
  if p_category is not null and p_category not in ('active','draft','pending','signed','attention') then
    raise exception 'Invalid dashboard category';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null)
    or (p_category is null and p_before_id is not null) then
    raise exception 'Invalid dashboard cursor';
  end if;

  -- Totals cover all of the owner's unarchived orders, not only the page.
  select jsonb_build_object(
    'allCount',count(*),
    'draftCount',count(*) filter(where status='draft'),
    'pendingCount',count(*) filter(where status in ('pending','changes_requested','declined')),
    'signedCount',count(*) filter(where status='signed'),
    'attentionCount',count(*) filter(where status in ('changes_requested','declined')),
    'paidCount',count(*) filter(where payment_status='paid'),
    'totalApprovedRevenue',coalesce(sum(cost) filter(where status='signed'),0),
    'totalPaidRevenue',coalesce(sum(cost) filter(where payment_status='paid'),0)
  ) into v_summary
  from public.orders where owner_id=v_owner and archived_at is null;

  if p_category is not null then
    v_selected_count := (v_summary ->> case p_category
      when 'active' then 'allCount' when 'draft' then 'draftCount'
      when 'pending' then 'pendingCount' when 'signed' then 'signedCount'
      else 'attentionCount' end)::bigint;
    -- An extra row determines whether another page exists; only ten are returned.
    with candidates as (
      select o.id, o.order_type, o.contractor_company, o.contractor_license, o.contractor_phone, o.contractor_email, o.custom_terms, o.project_title, o.client_name, o.client_phone, o.description, o.cost, o.status, o.cancelled_at, o.cancellation_reason, o.revision_number, o.client_response_note, o.client_responded_at, o.last_sent_at, o.payment_status, o.require_payment_upfront, o.signing_token, o.signed_at, o.signed_at_utc, o.signer_name, o.created_at
      from public.orders o
      where o.owner_id=v_owner and o.archived_at is null
        and (p_category='active'
          or (p_category='draft' and o.status='draft')
          or (p_category='pending' and o.status in ('pending','changes_requested','declined'))
          or (p_category='signed' and o.status='signed')
          or (p_category='attention' and o.status in ('changes_requested','declined')))
        and (p_before_created_at is null or (o.created_at,o.id)<(p_before_created_at,p_before_id))
      order by o.created_at desc,o.id desc limit 11
    ), page as (
      select * from candidates order by created_at desc,id desc limit 10
    )
    select coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb),
      (select count(*)>10 from candidates)
    into v_rows,v_has_more;
    if v_has_more then
      v_cursor := jsonb_build_object('created_at',v_rows->9->>'created_at','id',v_rows->9->>'id');
    end if;
  end if;
  return jsonb_build_object('orders',v_rows,'summary',v_summary,'selected_count',v_selected_count,
    'has_more',v_has_more,'next_cursor',v_cursor);
end;
$$;
revoke all on function public.signforth_dashboard_page(text,timestamptz,uuid) from public,anon;
grant execute on function public.signforth_dashboard_page(text,timestamptz,uuid) to authenticated;
commit;
