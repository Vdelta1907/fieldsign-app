-- Future media: immutable owner-scoped references; historical rows are not rewritten.
-- Install with writes disabled, deploy readers, then enable with the supplied cutover SQL.
begin;
do $$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='fieldsign_sign_order_with_evidence'
     and md5(pg_get_functiondef(p.oid))='9ed78e590f0a7a4d572ba27223fe0fd6') then
   raise exception 'Signing definition differs from the reviewed version. Stop and review before deploying.';
 end if;
end $$;

create table signforth_private.upload_settings (id boolean primary key default true check(id), enabled boolean not null default false);
insert into signforth_private.upload_settings values(true,false);
create table signforth_private.uploads (
 owner_id uuid not null references auth.users(id) on delete restrict,
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 byte_length integer not null check(byte_length between 1 and 1500000),
 mime_type text not null check(mime_type in ('image/png','image/jpeg')),
 created_at timestamptz not null default now(),
 primary key(owner_id,source_hash)
);
alter table signforth_private.uploads enable row level security;
alter table signforth_private.upload_settings enable row level security;
revoke all on signforth_private.uploads,signforth_private.upload_settings from public,anon,authenticated,service_role;

create function public.signforth_uploads_enabled() returns boolean language sql security definer set search_path='' as $$
 select enabled from signforth_private.upload_settings where id;
$$;
create function public.signforth_register_upload(p_owner uuid,p_hash text,p_bytes integer,p_mime text)
returns text language plpgsql security definer set search_path='' as $$
declare v signforth_private.uploads%rowtype;
begin
 if not public.signforth_uploads_enabled() then raise exception 'Private uploads are not enabled'; end if;
 insert into signforth_private.uploads(owner_id,source_hash,byte_length,mime_type)
 values(p_owner,p_hash,p_bytes,p_mime) on conflict do nothing;
 select * into strict v from signforth_private.uploads where owner_id=p_owner and source_hash=p_hash;
 if v.byte_length is distinct from p_bytes or v.mime_type is distinct from p_mime then raise exception 'Media metadata differs'; end if;
 return 'sfmedia:v1:'||p_hash;
end;
$$;
-- This private helper resolves only verified references belonging to the row owner.
create function signforth_private.media_metadata(p_source text,p_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v signforth_private.uploads%rowtype;
begin
 if p_source is null then return null; end if;
 if p_source like 'sfmedia:%' then
   if p_source !~ '^sfmedia:v1:[a-f0-9]{64}$' then raise exception 'Invalid media reference'; end if;
   select * into v from signforth_private.uploads where owner_id=p_owner and source_hash=substr(p_source,12);
   if not found then raise exception 'Media reference is not available for this account'; end if;
   return jsonb_build_object('sha256',v.source_hash,'byte_length',v.byte_length,'mime_type',v.mime_type);
 end if;
 return jsonb_build_object('sha256',encode(sha256(convert_to(p_source,'UTF8')),'hex'),'byte_length',octet_length(p_source));
end;
$$;
create function signforth_private.validate_media_references() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_field text; v_source text;
begin
 v_owner:=case when tg_table_name='orders' then (to_jsonb(new)->>'owner_id')::uuid else (to_jsonb(new)->>'user_id')::uuid end;
 foreach v_field in array case when tg_table_name='orders' then array['contractor_logo','photo_data','photo_data_2','signature_data'] else array['logo_data_url'] end loop
  v_source:=to_jsonb(new)->>v_field;
  if v_source like 'sfmedia:%' then perform signforth_private.media_metadata(v_source,v_owner); end if;
 end loop;
 return new;
end;
$$;
create trigger signforth_validate_order_media before insert or update on public.orders
 for each row execute function signforth_private.validate_media_references();
create trigger signforth_validate_profile_media before insert or update on public.contractor_profiles
 for each row execute function signforth_private.validate_media_references();

create function public.signforth_resolve_uploads(p_owner uuid,p_sources text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_source text; v_meta jsonb; v_result jsonb:='[]';
begin
 if coalesce(cardinality(p_sources),0) not between 1 and 4 then raise exception 'Invalid media request'; end if;
 foreach v_source in array p_sources loop
  if v_source is null or v_source !~ '^sfmedia:v1:[a-f0-9]{64}$' then raise exception 'Invalid media reference'; end if;
  v_meta:=signforth_private.media_metadata(v_source,p_owner);
  v_result:=v_result||jsonb_build_array(jsonb_build_object('reference',v_source,'field','contractor_logo',
    'sha256',v_meta->>'sha256','byteLength',(v_meta->>'byte_length')::int,'path',p_owner::text||'/'||(v_meta->>'sha256')||'.txt'));
 end loop;
 return v_result;
end;
$$;
create function public.signforth_signature_upload_context(p_token uuid,p_submission uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('owner_id',owner_id,'existing_signature',case when status='signed' then signature_data else null end)
 from public.orders where signing_token=p_token and archived_at is null
 and ((status='pending' and signing_expires_at>now()) or (status='signed' and signature_submission_id=p_submission));
$$;
CREATE OR REPLACE FUNCTION public.fieldsign_sign_order_with_evidence(p_token uuid, p_signer_name text, p_signature_data text, p_consent_text text, p_payment_requested boolean, p_submission_id uuid, p_signing_ip inet, p_user_agent text)
 RETURNS TABLE(signed_at_utc timestamp with time zone, payment_status text, already_recorded boolean, document_hash text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_signed_at timestamptz := now();
  v_payment_status text :=
    case
      when coalesce(p_payment_requested, false) then 'pending'
      else 'unpaid'
    end;
  v_user_agent text;
  v_terms text;
  v_snapshot jsonb;
  v_document_hash text;
  v_media_version integer;
  v_signature_meta jsonb;
begin
  if p_submission_id is null then
    raise exception 'A signature identifier is required.';
  end if;

  if nullif(trim(p_signer_name), '') is null
    or char_length(trim(p_signer_name)) > 120
  then
    raise exception 'A valid signer name is required.';
  end if;

  if p_signature_data is null
    or (p_signature_data not like 'data:image/png;base64,%' and p_signature_data !~ '^sfmedia:v1:[a-f0-9]{64}$')
    or octet_length(p_signature_data) > 750000
  then
    raise exception 'A valid signature is required.';
  end if;

  if p_consent_text is distinct from
    'I agree to conduct this transaction electronically, confirm that I reviewed the scope and amount, and intend my electronic signature to authorize this record.'
  then
    raise exception 'Electronic consent is invalid.';
  end if;

  if p_signing_ip is null then
    raise exception 'Signing network information is required.';
  end if;

  v_user_agent := left(trim(coalesce(p_user_agent, '')), 512);

  if v_user_agent = '' then
    raise exception 'Signing browser information is required.';
  end if;

  select *
  into v_order
  from public.orders
  where signing_token = p_token
    and archived_at is null
  for update;

  if not found then
    raise exception 'This signing link is invalid or no longer active.';
  end if;

  -- A successful retry returns the original evidence unchanged.
  if v_order.signature_submission_id = p_submission_id
    and v_order.status = 'signed'
  then
    select evidence.document_hash
    into v_document_hash
    from public.order_authorization_evidence evidence
    where evidence.order_id = v_order.id
      and evidence.signature_submission_id = p_submission_id
    limit 1;

    return query
    select
      v_order.signed_at_utc,
      v_order.payment_status,
      true,
      v_document_hash;

    return;
  end if;

  if v_order.status <> 'pending'
    or v_order.signing_expires_at <= v_signed_at
  then
    raise exception 'This signing link is invalid, expired, or already used.';
  end if;

  if coalesce(p_payment_requested, false)
    and not coalesce(v_order.require_payment_upfront, false)
  then
    raise exception 'Stripe payment is not enabled for this order.';
  end if;

  v_signature_meta:=signforth_private.media_metadata(p_signature_data,v_order.owner_id);
  if (v_signature_meta->>'byte_length')::int > 750000
    or (p_signature_data like 'sfmedia:%' and v_signature_meta->>'mime_type' <> 'image/png') then
    raise exception 'A valid signature is required.';
  end if;
  v_media_version:=case when p_signature_data like 'sfmedia:%' or v_order.contractor_logo like 'sfmedia:%'
    or v_order.photo_data like 'sfmedia:%' or v_order.photo_data_2 like 'sfmedia:%' then 3 else 2 end;

  -- Match the client display: use order terms, otherwise the default.
  -- Preserve nonempty order terms exactly as stored.
  v_terms := coalesce(
    nullif(v_order.custom_terms, ''),
    'The undersigned authorizes the contractor to perform the modifications or services described above. Labor, equipment, and materials will be provided in accordance with the stated scope and payment terms. By checking the consent box and signing, the signer confirms their intent to authorize this electronic record and agrees to receive and retain it electronically.'
  );

  v_snapshot := jsonb_build_object(
    'snapshot_version', v_media_version,
    'canonicalization', 'postgres-jsonb-text-v1',

    'order', jsonb_build_object(
      'id', v_order.id,
      'revision_number', v_order.revision_number,
      'order_type', v_order.order_type,
      'project_title', v_order.project_title,
      'created_at', v_order.created_at,
      'last_sent_at', v_order.last_sent_at
    ),

    'contractor', jsonb_build_object(
      'company', v_order.contractor_company,
      'license', v_order.contractor_license,
      'phone', v_order.contractor_phone,
      'email', v_order.contractor_email,
      'displayed_logo',
        case
          when v_order.contractor_logo is null then null
          else jsonb_build_object(
            'sha256', (signforth_private.media_metadata(v_order.contractor_logo,v_order.owner_id)->>'sha256'),
            'byte_length', (signforth_private.media_metadata(v_order.contractor_logo,v_order.owner_id)->>'byte_length')::int
          )
        end
    ),

    'client', jsonb_build_object(
      'name', v_order.client_name,
      'phone', v_order.client_phone
    ),

    'authorization', jsonb_build_object(
      'scope', v_order.description,
      'amount', v_order.cost,
      'currency', 'USD',
      'custom_terms', v_terms,
      'terms_source',
        case
          when nullif(v_order.custom_terms, '') is null
            then 'default-v1'
          else 'order'
        end,
      'electronic_consent', p_consent_text
    ),

    'photos', jsonb_build_array(
      case
        when v_order.photo_data is null then null
        else jsonb_build_object(
          'slot', 1,
          'sha256', (signforth_private.media_metadata(v_order.photo_data,v_order.owner_id)->>'sha256'),
          'byte_length', (signforth_private.media_metadata(v_order.photo_data,v_order.owner_id)->>'byte_length')::int
        )
      end,
      case
        when v_order.photo_data_2 is null then null
        else jsonb_build_object(
          'slot', 2,
          'sha256', (signforth_private.media_metadata(v_order.photo_data_2,v_order.owner_id)->>'sha256'),
          'byte_length', (signforth_private.media_metadata(v_order.photo_data_2,v_order.owner_id)->>'byte_length')::int
        )
      end
    ),

    'signature', jsonb_build_object(
      'signer_name', trim(p_signer_name),
      'signature_sha256', (v_signature_meta->>'sha256'),
      'signature_byte_length', (v_signature_meta->>'byte_length')::int,
      'signature_media_type', 'image/png',
      'submission_id', p_submission_id,
      'signed_at_utc', v_signed_at
    ),

    'payment_choice', jsonb_build_object(
      'secure_payment_offered',
        coalesce(v_order.require_payment_upfront, false),
      'pay_now_selected', coalesce(p_payment_requested, false),
      'initial_payment_status', v_payment_status
    )
  );

  v_document_hash := encode(
    extensions.digest(
      convert_to(v_snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  update public.orders
  set
    status = 'signed',
    custom_terms = v_terms,
    signature_data = p_signature_data,
    signer_name = trim(p_signer_name),
    consent_text = p_consent_text,
    signed_at_utc = v_signed_at,
    signed_user_agent = v_user_agent,
    payment_status = v_payment_status,
    signature_submission_id = p_submission_id,
    updated_at = v_signed_at
  where id = v_order.id;

  insert into public.order_authorization_evidence (
    order_id,
    owner_id,
    revision_number,
    signature_submission_id,
    snapshot_version,
    evidence_snapshot,
    document_hash,
    hash_algorithm,
    signer_name,
    signed_at_utc,
    signing_ip,
    signed_user_agent,
    created_at
  )
  values (
    v_order.id,
    v_order.owner_id,
    v_order.revision_number,
    p_submission_id,
    v_media_version,
    v_snapshot,
    v_document_hash,
    'SHA-256',
    trim(p_signer_name),
    v_signed_at,
    p_signing_ip,
    v_user_agent,
    v_signed_at
  );

  return query
  select
    v_signed_at,
    v_payment_status,
    false,
    v_document_hash;
end;
$function$
;
create or replace function public.signforth_get_order_media(p_token uuid default null,p_order_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_result jsonb; v_media jsonb:='[]'::jsonb; v_field text; v_ref signforth_private.order_media%rowtype; v_source text; v_meta jsonb;
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
    v_source:=to_jsonb(v_order)->>v_field;
    if v_source like 'sfmedia:%' then
      v_meta:=signforth_private.media_metadata(v_source,v_order.owner_id);
      v_result:=v_result||jsonb_build_object(v_field,null);
      v_media:=v_media||jsonb_build_array(jsonb_build_object('field',v_field,'sha256',v_meta->>'sha256',
        'byteLength',(v_meta->>'byte_length')::int,'path',v_order.owner_id::text||'/'||(v_meta->>'sha256')||'.txt'));
      continue;
    end if;
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
create or replace function public.signforth_next_media_order()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('id',o.id,'owner_id',o.owner_id,
    'contractor_logo',o.contractor_logo,'photo_data',o.photo_data,
    'photo_data_2',o.photo_data_2,'signature_data',o.signature_data)
  from public.orders o
  where o.status='signed' and o.archived_at is null
    and not exists(select 1 from signforth_private.media_prepared_orders m where m.order_id=o.id)
  and not exists(select 1 from unnest(array[o.contractor_logo,o.photo_data,o.photo_data_2,o.signature_data]) value where value like 'sfmedia:%')
  order by o.created_at,o.id limit 1;
$$;
revoke all on function public.signforth_uploads_enabled() from public,anon,authenticated;
grant execute on function public.signforth_uploads_enabled() to service_role;
revoke all on function public.signforth_register_upload(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.signforth_register_upload(uuid,text,integer,text) to service_role;
revoke all on function public.signforth_resolve_uploads(uuid,text[]) from public,anon,authenticated;
grant execute on function public.signforth_resolve_uploads(uuid,text[]) to service_role;
revoke all on function public.signforth_signature_upload_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.signforth_signature_upload_context(uuid,uuid) to service_role;
revoke all on function signforth_private.media_metadata(text,uuid) from public,anon,authenticated,service_role;
revoke all on function signforth_private.validate_media_references() from public,anon,authenticated,service_role;
create or replace function public.signforth_media_progress()
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
   'remaining', (select count(*) from public.orders o where o.status='signed' and o.archived_at is null
     and not exists(select 1 from unnest(array[o.contractor_logo,o.photo_data,o.photo_data_2,o.signature_data]) value where value like 'sfmedia:%')
     and not exists(select 1 from signforth_private.media_prepared_orders m where m.order_id=o.id)),
   'prepared', (select count(*) from signforth_private.media_prepared_orders),
   'references', (select count(*) from signforth_private.order_media),
   'unique_objects', (select count(distinct object_path) from signforth_private.order_media));
$$;
commit;
