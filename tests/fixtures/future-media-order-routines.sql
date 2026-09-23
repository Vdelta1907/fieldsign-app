CREATE OR REPLACE FUNCTION public.fieldsign_create_order(p_client_submission_id uuid, p_order_type text, p_contractor_company text, p_contractor_logo text, p_contractor_license text, p_contractor_phone text, p_contractor_email text, p_custom_terms text, p_project_title text, p_client_name text, p_client_phone text, p_description text, p_cost numeric, p_photo_data text, p_photo_data_2 text, p_require_payment_upfront boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception
      'Authentication is required.';
  end if;

  if p_client_submission_id is null then
    raise exception
      'A submission identifier is required.';
  end if;

  if p_order_type is null
    or p_order_type not in (
      'Change Order',
      'New Job Agreement'
    )
  then
    raise exception
      'Invalid order type.';
  end if;

  if nullif(trim(p_contractor_company), '') is null
    or nullif(trim(p_project_title), '') is null
    or nullif(trim(p_client_name), '') is null
    or nullif(trim(p_client_phone), '') is null
    or nullif(trim(p_description), '') is null
  then
    raise exception
      'Complete order details are required.';
  end if;

  if char_length(trim(p_contractor_company)) > 160
    or char_length(trim(p_project_title)) > 200
    or char_length(trim(p_client_name)) > 160
    or char_length(trim(p_client_phone)) > 50
    or char_length(trim(
      coalesce(p_contractor_license, '')
    )) > 160
    or char_length(trim(
      coalesce(p_contractor_phone, '')
    )) > 50
    or char_length(trim(
      coalesce(p_contractor_email, '')
    )) > 320
    or char_length(trim(p_description)) > 10000
    or char_length(trim(
      coalesce(p_custom_terms, '')
    )) > 20000
  then
    raise exception
      'One or more order fields exceed the allowed length.';
  end if;

  if p_cost is null
    or p_cost <= 0
    or p_cost > 999999.99
    or p_cost <> round(p_cost, 2)
  then
    raise exception
      'Enter a valid amount between $0.01 and $999,999.99 using no more than two decimal places.';
  end if;

  if coalesce(p_require_payment_upfront, false)
    and p_cost < 0.50
  then
    raise exception
      'Stripe payments require an amount of at least $0.50.';
  end if;

  if p_contractor_logo is not null
    and octet_length(p_contractor_logo) > 1500000
  then
    raise exception
      'The contractor logo is too large.';
  end if;

  if p_photo_data is not null
    and octet_length(p_photo_data) > 1500000
  then
    raise exception
      'Photo 1 is too large.';
  end if;

  if p_photo_data_2 is not null
    and octet_length(p_photo_data_2) > 1500000
  then
    raise exception
      'Photo 2 is too large.';
  end if;

  insert into public.orders (
    client_submission_id,
    owner_id,
    order_type,
    contractor_company,
    contractor_logo,
    contractor_license,
    contractor_phone,
    contractor_email,
    custom_terms,
    project_title,
    client_name,
    client_phone,
    description,
    cost,
    photo_data,
    photo_data_2,
    require_payment_upfront,
    status,
    payment_status,
    last_sent_at,
    signing_expires_at,
    updated_at
  )
  values (
    p_client_submission_id,
    auth.uid(),
    p_order_type,
    trim(p_contractor_company),
    nullif(p_contractor_logo, ''),
    nullif(trim(p_contractor_license), ''),
    nullif(trim(p_contractor_phone), ''),
    nullif(trim(p_contractor_email), ''),
    nullif(trim(p_custom_terms), ''),
    trim(p_project_title),
    trim(p_client_name),
    trim(p_client_phone),
    trim(p_description),
    p_cost,
    nullif(p_photo_data, ''),
    nullif(p_photo_data_2, ''),
    coalesce(p_require_payment_upfront, false),
    'pending',
    'unpaid',
    now(),
    now() + interval '30 days',
    now()
  )
  on conflict (client_submission_id) do nothing
  returning *
  into v_order;

  -- A retry returns the order created by the first request.
  if not found then
    select *
    into v_order
    from public.orders
    where client_submission_id =
      p_client_submission_id
      and owner_id = auth.uid();

    if not found then
      raise exception
        'The order submission could not be resolved.';
    end if;
  end if;

  return to_jsonb(v_order);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.fieldsign_start_revision(p_order_id uuid, p_revision_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_new_revision integer;
  v_new_token uuid;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception
      'Authentication is required.';
  end if;

  v_reason :=
    nullif(trim(p_revision_reason), '');

  if v_reason is not null
    and char_length(v_reason) > 2000
  then
    raise exception
      'The revision reason is too long.';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and owner_id = auth.uid()
    and archived_at is null
  for update;

  if not found then
    raise exception
      'Order not found or unavailable.';
  end if;

  if v_order.status is null
    or v_order.status not in (
      'pending',
      'changes_requested',
      'declined'
    )
  then
    raise exception
      'This order cannot be revised in its current status.';
  end if;

  -- Preserve the version previously received by the client.
  insert into public.order_revisions (
    order_id,
    revision_number,
    snapshot,
    revision_reason,
    created_by
  )
  values (
    v_order.id,
    v_order.revision_number,
    to_jsonb(v_order) - 'signing_token',
    v_reason,
    auth.uid()
  );

  -- Privately record why the previous link was retired.
  insert into public.retired_signing_links (
    order_id,
    signing_token,
    retired_reason
  )
  values (
    v_order.id,
    v_order.signing_token,
    'superseded'
  )
  on conflict (signing_token) do nothing;

  v_new_revision :=
    v_order.revision_number + 1;

  v_new_token := gen_random_uuid();

  update public.orders
  set
    revision_number = v_new_revision,
    status = 'draft',
    signing_token = v_new_token,
    signing_expires_at =
      now() + interval '30 days',

    client_response_note = null,
    client_response_submission_id = null,
    client_responded_at = null,
    last_sent_at = null,
    last_publish_submission_id = null,

    signature_data = null,
    signature_submission_id = null,
    signer_name = null,
    consent_text = null,
    signed_at = null,
    signed_at_utc = null,
    signed_user_agent = null,

    payment_status = 'unpaid',
    stripe_checkout_session_id = null,
    stripe_payment_intent_id = null,

    updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'revision_number', v_new_revision,
    'status', 'draft',
    'signing_token', v_new_token
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.fieldsign_publish_revision(p_order_id uuid, p_expected_signing_token uuid, p_publish_submission_id uuid, p_order_type text, p_contractor_company text, p_contractor_logo text, p_contractor_license text, p_contractor_phone text, p_contractor_email text, p_custom_terms text, p_project_title text, p_client_name text, p_client_phone text, p_description text, p_cost numeric, p_photo_data text, p_photo_data_2 text, p_require_payment_upfront boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception
      'Authentication is required.';
  end if;

  if p_publish_submission_id is null then
    raise exception
      'A publish identifier is required.';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and owner_id = auth.uid()
    and archived_at is null
  for update;

  if not found then
    raise exception
      'Order not found or unavailable.';
  end if;

  -- Prevent an older tab from publishing a newer version.
  if v_order.signing_token
    is distinct from p_expected_signing_token
  then
    raise exception
      'This draft has been replaced by a newer version. Reopen it from the dashboard.';
  end if;

  -- Return the original result after a repeated request.
  if v_order.last_publish_submission_id =
    p_publish_submission_id
  then
    return to_jsonb(v_order);
  end if;

  if v_order.status <> 'draft' then
    raise exception
      'This order is no longer an editable draft.';
  end if;

  if p_order_type is null
    or p_order_type not in (
      'Change Order',
      'New Job Agreement'
    )
  then
    raise exception
      'Invalid order type.';
  end if;

  if nullif(trim(p_contractor_company), '') is null
    or nullif(trim(p_project_title), '') is null
    or nullif(trim(p_client_name), '') is null
    or nullif(trim(p_client_phone), '') is null
    or nullif(trim(p_description), '') is null
  then
    raise exception
      'Complete order details are required.';
  end if;

  if char_length(trim(p_contractor_company)) > 160
    or char_length(trim(p_project_title)) > 200
    or char_length(trim(p_client_name)) > 160
    or char_length(trim(p_client_phone)) > 50
    or char_length(trim(
      coalesce(p_contractor_license, '')
    )) > 160
    or char_length(trim(
      coalesce(p_contractor_phone, '')
    )) > 50
    or char_length(trim(
      coalesce(p_contractor_email, '')
    )) > 320
    or char_length(trim(p_description)) > 10000
    or char_length(trim(
      coalesce(p_custom_terms, '')
    )) > 20000
  then
    raise exception
      'One or more order fields exceed the allowed length.';
  end if;

  if p_cost is null
    or p_cost <= 0
    or p_cost > 999999.99
    or p_cost <> round(p_cost, 2)
  then
    raise exception
      'Enter a valid amount between $0.01 and $999,999.99 using no more than two decimal places.';
  end if;

  if coalesce(p_require_payment_upfront, false)
    and p_cost < 0.50
  then
    raise exception
      'Stripe payments require an amount of at least $0.50.';
  end if;

  if p_contractor_logo is not null
    and octet_length(p_contractor_logo) > 1500000
  then
    raise exception
      'The contractor logo is too large.';
  end if;

  if p_photo_data is not null
    and octet_length(p_photo_data) > 1500000
  then
    raise exception
      'Photo 1 is too large.';
  end if;

  if p_photo_data_2 is not null
    and octet_length(p_photo_data_2) > 1500000
  then
    raise exception
      'Photo 2 is too large.';
  end if;

  update public.orders
  set
    order_type = p_order_type,
    contractor_company =
      trim(p_contractor_company),
    contractor_logo =
      nullif(p_contractor_logo, ''),
    contractor_license =
      nullif(trim(p_contractor_license), ''),
    contractor_phone =
      nullif(trim(p_contractor_phone), ''),
    contractor_email =
      nullif(trim(p_contractor_email), ''),
    custom_terms =
      nullif(trim(p_custom_terms), ''),
    project_title = trim(p_project_title),
    client_name = trim(p_client_name),
    client_phone = trim(p_client_phone),
    description = trim(p_description),
    cost = p_cost,
    photo_data = nullif(p_photo_data, ''),
    photo_data_2 = nullif(p_photo_data_2, ''),
    require_payment_upfront =
      coalesce(p_require_payment_upfront, false),

    status = 'pending',
    payment_status = 'unpaid',
    stripe_checkout_session_id = null,
    stripe_payment_intent_id = null,
    last_publish_submission_id =
      p_publish_submission_id,
    last_sent_at = now(),
    signing_expires_at =
      now() + interval '30 days',
    updated_at = now()

  where id = p_order_id
  returning *
  into v_order;

  return to_jsonb(v_order);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.fieldsign_send_for_review(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception
      'Please sign in to resend an order.';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and owner_id = auth.uid()
    and archived_at is null
  for update;

  if not found then
    raise exception
      'This order is unavailable for sending.';
  end if;

  -- Draft revisions must be validated and published through
  -- fieldsign_publish_revision. This function only resends
  -- an already-published pending order.
  if v_order.status is distinct from 'pending' then
    raise exception
      'Only a pending order can be resent.';
  end if;

  update public.orders
  set
    last_sent_at = now(),
    signing_expires_at =
      now() + interval '30 days',
    updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'revision_number', v_order.revision_number,
    'status', 'pending',
    'signing_token', v_order.signing_token
  );
end;
$function$
;
