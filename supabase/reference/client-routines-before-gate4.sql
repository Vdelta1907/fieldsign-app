-- REFERENCE ONLY: supplied deployed definitions, September 18, 2026.
-- Not a migration. Do not run this file. Gate 4 changes privileges, not these bodies.

CREATE OR REPLACE FUNCTION public.get_order_for_signing(p_token uuid)
 RETURNS TABLE(id uuid, order_type text, contractor_company text, contractor_logo text, contractor_license text, contractor_phone text, contractor_email text, custom_terms text, project_title text, client_name text, client_phone text, description text, cost numeric, status text, payment_status text, require_payment_upfront boolean, payments_enabled boolean, photo_data text, photo_data_2 text, signature_data text, signer_name text, signed_at_utc timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    o.id, o.order_type, o.contractor_company, o.contractor_logo,
    o.contractor_license, o.contractor_phone, o.contractor_email,
    o.custom_terms, o.project_title, o.client_name, o.client_phone,
    o.description, o.cost, o.status, o.payment_status,
    o.require_payment_upfront,
    coalesce(p.stripe_charges_enabled, false) as payments_enabled,
    o.photo_data, o.photo_data_2, o.signature_data, o.signer_name,
    o.signed_at_utc, o.created_at
  from public.orders o
  left join public.contractor_profiles p on p.user_id = o.owner_id
  where o.signing_token = p_token
    and o.archived_at is null
    and (o.status = 'signed' or o.signing_expires_at > now())
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.fieldsign_get_link_state(p_signing_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_state text;
  v_retired_reason text;
begin
  if p_signing_token is null then
    return jsonb_build_object('state', 'invalid');
  end if;

  select
    case
      when o.archived_at is not null then 'archived'
      when o.status = 'cancelled' then 'cancelled'
      when o.status = 'signed' then 'signed'
      when o.status = 'changes_requested'
        then 'changes_requested'
      when o.status = 'declined' then 'declined'
      when o.status = 'pending'
        and o.signing_expires_at <= now()
        then 'expired'
      when o.status = 'pending' then 'active'
      when o.status = 'draft' then 'not_active'
      else 'not_active'
    end
  into v_state
  from public.orders o
  where o.signing_token = p_signing_token
  limit 1;

  if found then
    return jsonb_build_object('state', v_state);
  end if;

  select r.retired_reason
  into v_retired_reason
  from public.retired_signing_links r
  where r.signing_token = p_signing_token
  limit 1;

  if found then
    return jsonb_build_object(
      'state',
      case
        when v_retired_reason = 'superseded'
          then 'superseded'
        when v_retired_reason = 'archived'
          then 'archived'
        else 'not_active'
      end
    );
  end if;

  return jsonb_build_object('state', 'invalid');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fieldsign_submit_client_response_v2(p_signing_token uuid, p_response text, p_note text DEFAULT NULL::text, p_submission_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_response text;
  v_note text;
begin
  v_response := lower(trim(p_response));
  v_note := nullif(trim(p_note), '');

  if p_submission_id is null then
    raise exception
      'A response identifier is required.';
  end if;

  if v_response is null
    or v_response not in (
      'changes_requested',
      'declined'
    )
  then
    raise exception
      'Invalid client response.';
  end if;

  if v_response = 'changes_requested'
    and v_note is null
  then
    raise exception
      'Please describe the requested changes.';
  end if;

  if v_note is not null
    and char_length(v_note) > 2000
  then
    raise exception
      'The client response note is too long.';
  end if;

  select *
  into v_order
  from public.orders
  where signing_token = p_signing_token
    and archived_at is null
  for update;

  if not found then
    raise exception
      'This signing link is invalid or no longer active.';
  end if;

  -- Return the first successful result when the same
  -- client request is retried.
  if v_order.client_response_submission_id =
      p_submission_id
    and v_order.status in (
      'changes_requested',
      'declined'
    )
  then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'response_recorded', true,
      'already_recorded', true
    );
  end if;

  if v_order.status <> 'pending'
    or v_order.signing_expires_at <= now()
  then
    raise exception
      'This signing link is invalid or no longer active.';
  end if;

  update public.orders
  set
    status = v_response,
    client_response_note = v_note,
    client_response_submission_id =
      p_submission_id,
    client_responded_at = now(),
    updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', v_response,
    'response_recorded', true,
    'already_recorded', false
  );
end;
$function$
;

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
    or p_signature_data not like 'data:image/png;base64,%'
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

  -- Match the client display: use order terms, otherwise the default.
  -- Preserve nonempty order terms exactly as stored.
  v_terms := coalesce(
    nullif(v_order.custom_terms, ''),
    'The undersigned authorizes the contractor to perform the modifications or services described above. Labor, equipment, and materials will be provided in accordance with the stated scope and payment terms. By checking the consent box and signing, the signer confirms their intent to authorize this electronic record and agrees to receive and retain it electronically.'
  );

  v_snapshot := jsonb_build_object(
    'snapshot_version', 2,
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
            'sha256', encode(
              extensions.digest(
                convert_to(v_order.contractor_logo, 'UTF8'),
                'sha256'
              ),
              'hex'
            ),
            'byte_length', octet_length(v_order.contractor_logo)
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
          'sha256', encode(
            extensions.digest(
              convert_to(v_order.photo_data, 'UTF8'),
              'sha256'
            ),
            'hex'
          ),
          'byte_length', octet_length(v_order.photo_data)
        )
      end,
      case
        when v_order.photo_data_2 is null then null
        else jsonb_build_object(
          'slot', 2,
          'sha256', encode(
            extensions.digest(
              convert_to(v_order.photo_data_2, 'UTF8'),
              'sha256'
            ),
            'hex'
          ),
          'byte_length', octet_length(v_order.photo_data_2)
        )
      end
    ),

    'signature', jsonb_build_object(
      'signer_name', trim(p_signer_name),
      'signature_sha256', encode(
        extensions.digest(
          convert_to(p_signature_data, 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      'signature_byte_length', octet_length(p_signature_data),
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
    2,
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