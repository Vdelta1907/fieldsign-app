-- Stage 1: verified private copies for SIGNED orders; originals remain untouched.
-- Apply only this new migration to the reviewed existing project.
begin;
create schema if not exists signforth_private;
revoke all on schema signforth_private from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('signforth-order-media-v1','signforth-order-media-v1',false,8000000,array['text/plain'])
on conflict (id) do nothing;
do $$ begin
  if exists(select 1 from storage.buckets where id='signforth-order-media-v1' and public) then
    raise exception 'The order media bucket must be private';
  end if;
end $$;
-- No client Storage policies are added. Only server-issued short-lived downloads.
-- Restrictive policy also prevents any broad client policy from admitting this bucket.
create policy signforth_private_media_no_direct_client_access on storage.objects
as restrictive for all to anon, authenticated
using (bucket_id <> 'signforth-order-media-v1')
with check (bucket_id <> 'signforth-order-media-v1');

create table signforth_private.order_media (
  order_id uuid not null references public.orders(id),
  owner_id uuid not null,
  field_name text not null check(field_name in ('contractor_logo','photo_data','photo_data_2','signature_data')),
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  byte_length integer not null check(byte_length between 1 and 8000000),
  object_path text not null,
  created_at timestamptz not null default now(),
  primary key(order_id,field_name)
);
create table signforth_private.media_prepared_orders (
  order_id uuid primary key references public.orders(id),
  prepared_at timestamptz not null default now()
);
alter table signforth_private.order_media enable row level security;
alter table signforth_private.media_prepared_orders enable row level security;
revoke all on signforth_private.order_media, signforth_private.media_prepared_orders from public, anon, authenticated;

-- Service-only worker input. One order at a time keeps memory bounded.
create function public.signforth_next_media_order()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('id',o.id,'owner_id',o.owner_id,
    'contractor_logo',o.contractor_logo,'photo_data',o.photo_data,
    'photo_data_2',o.photo_data_2,'signature_data',o.signature_data)
  from public.orders o
  where o.status='signed' and o.archived_at is null
    and not exists(select 1 from signforth_private.media_prepared_orders m where m.order_id=o.id)
  order by o.created_at,o.id limit 1;
$$;

-- Publish a reference only after the worker has read-back and verified the object.
-- Derive owner/path from the immutable order, never a browser-supplied path.
create function public.signforth_register_order_media(p_order_id uuid,p_field text,p_hash text,p_bytes integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_source text; v_hash text; v_existing signforth_private.order_media%rowtype;
begin
  if p_field is null or p_field not in ('contractor_logo','photo_data','photo_data_2','signature_data') then
    raise exception 'Invalid media field';
  end if;
  select * into v_order from public.orders where id=p_order_id and status='signed' for share;
  if not found then raise exception 'Only signed media can be prepared'; end if;
  v_source := to_jsonb(v_order)->>p_field;
  v_hash := encode(sha256(convert_to(v_source,'UTF8')),'hex');
  if v_source is null or v_source='' or p_hash is distinct from v_hash
     or p_bytes is distinct from octet_length(v_source) then
    raise exception 'Original media verification failed';
  end if;
  insert into signforth_private.order_media(order_id,owner_id,field_name,source_hash,byte_length,object_path)
  values(p_order_id,v_order.owner_id,p_field,v_hash,p_bytes,v_order.owner_id::text || '/' || v_hash || '.txt')
  on conflict(order_id,field_name) do nothing;
  select * into v_existing from signforth_private.order_media where order_id=p_order_id and field_name=p_field;
  if v_existing.source_hash is distinct from v_hash or v_existing.owner_id is distinct from v_order.owner_id then
    raise exception 'Existing media reference differs from the original';
  end if;
end;
$$;

create function public.signforth_finish_media_order(p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_field text; v_source text;
begin
  select * into v_order from public.orders where id=p_order_id and status='signed' for share;
  if not found then raise exception 'Only signed media can be prepared'; end if;
  foreach v_field in array array['contractor_logo','photo_data','photo_data_2','signature_data'] loop
    v_source:=to_jsonb(v_order)->>v_field;
    if coalesce(v_source,'')<>'' and not exists(
      select 1 from signforth_private.order_media m where m.order_id=p_order_id and m.field_name=v_field
        and m.owner_id=v_order.owner_id and m.source_hash=encode(sha256(convert_to(v_source,'UTF8')),'hex')
        and m.byte_length=octet_length(v_source)
    ) then raise exception 'Media preparation is incomplete'; end if;
  end loop;
  insert into signforth_private.media_prepared_orders(order_id) values(p_order_id) on conflict do nothing;
end;
$$;

create function public.signforth_media_progress()
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
   'remaining', (select count(*) from public.orders o where o.status='signed' and o.archived_at is null
     and not exists(select 1 from signforth_private.media_prepared_orders m where m.order_id=o.id)),
   'prepared', (select count(*) from signforth_private.media_prepared_orders),
   'references', (select count(*) from signforth_private.order_media),
   'unique_objects', (select count(distinct object_path) from signforth_private.order_media));
$$;

-- One explicit metadata shape for authorized owner PDFs and public client review.
-- Old get_order_for_signing stays unchanged for rollback/old browser versions.
create function public.signforth_get_order_media(p_token uuid default null,p_order_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_result jsonb; v_media jsonb:='[]'::jsonb; v_field text; v_ref signforth_private.order_media%rowtype;
begin
  if p_token is not null and p_order_id is null and p_owner_id is null then
    select * into v_order from public.orders o where o.signing_token=p_token and o.archived_at is null
      and (o.status='signed' or o.signing_expires_at>now()) limit 1;
  elsif p_token is null and p_order_id is not null and p_owner_id is not null then
    select * into v_order from public.orders o where o.id=p_order_id and o.owner_id=p_owner_id
      and o.archived_at is null and o.status='signed';
  else raise exception 'Invalid media access context'; end if;
  if not found then return null; end if;
  v_result:=jsonb_build_object(
    'id',v_order.id,'order_type',v_order.order_type,'contractor_company',v_order.contractor_company,
    'contractor_license',v_order.contractor_license,'contractor_phone',v_order.contractor_phone,
    'contractor_email',v_order.contractor_email,'custom_terms',v_order.custom_terms,
    'project_title',v_order.project_title,'client_name',v_order.client_name,'client_phone',v_order.client_phone,
    'description',v_order.description,'cost',v_order.cost,'status',v_order.status,
    'payment_status',v_order.payment_status,'require_payment_upfront',v_order.require_payment_upfront,
    'payments_enabled',coalesce((select stripe_charges_enabled from public.contractor_profiles where user_id=v_order.owner_id),false),
    'signer_name',v_order.signer_name,'signed_at',v_order.signed_at,'signed_at_utc',v_order.signed_at_utc,
    'created_at',v_order.created_at);
  foreach v_field in array array['contractor_logo','photo_data','photo_data_2','signature_data'] loop
    select * into v_ref from signforth_private.order_media m
      where m.order_id=v_order.id and m.owner_id=v_order.owner_id and m.field_name=v_field and v_order.status='signed';
    if found then
      v_result:=v_result || jsonb_build_object(v_field,null);
      v_media:=v_media || jsonb_build_array(jsonb_build_object('field',v_field,'sha256',v_ref.source_hash,
        'byteLength',v_ref.byte_length,'path',v_ref.object_path));
    else
      v_result:=v_result || jsonb_build_object(v_field,to_jsonb(v_order)->v_field);
    end if;
  end loop;
  return v_result || jsonb_build_object('_media',v_media);
end;
$$;

revoke all on function public.signforth_next_media_order() from public,anon,authenticated;
revoke all on function public.signforth_register_order_media(uuid,text,text,integer) from public,anon,authenticated;
revoke all on function public.signforth_finish_media_order(uuid) from public,anon,authenticated;
revoke all on function public.signforth_media_progress() from public,anon,authenticated;
revoke all on function public.signforth_get_order_media(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.signforth_next_media_order() to service_role;
grant execute on function public.signforth_register_order_media(uuid,text,text,integer) to service_role;
grant execute on function public.signforth_finish_media_order(uuid) to service_role;
grant execute on function public.signforth_media_progress() to service_role;
grant execute on function public.signforth_get_order_media(uuid,uuid,uuid) to service_role;
commit;
