-- Read-only account export. No existing table grants, policies, records or workflows change.
BEGIN;
CREATE OR REPLACE FUNCTION signforth_private.export_redact(value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 IF jsonb_typeof(value) = 'object' THEN
  SELECT coalesce(jsonb_object_agg(key, signforth_private.export_redact(v)), '{}'::jsonb)
  INTO result FROM jsonb_each(value) AS item(key,v)
  WHERE lower(key) !~ '(token|secret|password)' AND lower(key) <> 'payment_link';
  RETURN result;
 ELSIF jsonb_typeof(value) = 'array' THEN
  SELECT coalesce(jsonb_agg(signforth_private.export_redact(v) ORDER BY n), '[]'::jsonb)
  INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS item(v,n);
  RETURN result;
 END IF;
 RETURN value;
END;
$$;
REVOKE ALL ON FUNCTION signforth_private.export_redact(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.signforth_export_account_page(p_section text, p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); item jsonb; item_id uuid; safe_item jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 -- One record per request bounds image-heavy orders and histories. UUID keyset pagination,
 -- independent of dashboard filters, deliberately includes retained archived orders.
 CASE p_section
 WHEN 'profile' THEN
  SELECT r.user_id, (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(r)) WHERE key=ANY(ARRAY['user_id','company_name','license_number','phone','email','logo_data_url','custom_terms','require_payment_upfront','stripe_account_id','stripe_charges_enabled','stripe_details_submitted','created_at','updated_at','use_default_terms','onboarding_complete']))
  INTO item_id, item FROM public.contractor_profiles r
  WHERE r.user_id = actor AND (p_after IS NULL OR r.user_id>p_after)
  ORDER BY r.user_id LIMIT 1;
 WHEN 'orders' THEN
  SELECT r.id, (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(r)) WHERE key=ANY(ARRAY['id','order_type','contractor_company','contractor_logo','contractor_license','contractor_phone','contractor_email','custom_terms','project_title','client_name','client_phone','description','cost','status','payment_status','photo_data','photo_data_2','signature_data','signed_at','created_at','owner_id','require_payment_upfront','signer_name','consent_text','signed_at_utc','signed_user_agent','archived_at','updated_at','stripe_checkout_session_id','stripe_payment_intent_id','revision_number','client_response_note','client_responded_at','last_sent_at','signature_submission_id','cancelled_at','cancellation_reason']))
  INTO item_id, item FROM public.orders r
  WHERE r.owner_id = actor AND (p_after IS NULL OR r.id>p_after)
  ORDER BY r.id LIMIT 1;
 WHEN 'revisions' THEN
  SELECT r.id, (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(r)) WHERE key=ANY(ARRAY['id','order_id','revision_number','snapshot','revision_reason','created_by','created_at']))
  INTO item_id, item FROM public.order_revisions r
  WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.id=r.order_id AND o.owner_id=actor) AND (p_after IS NULL OR r.id>p_after)
  ORDER BY r.id LIMIT 1;
 WHEN 'activity' THEN
  SELECT r.id, (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(r)) WHERE key=ANY(ARRAY['id','order_id','event_type','revision_number','occurred_at','details']))
  INTO item_id, item FROM public.order_activity r
  WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.id=r.order_id AND o.owner_id=actor) AND (p_after IS NULL OR r.id>p_after)
  ORDER BY r.id LIMIT 1;
 WHEN 'evidence' THEN
  SELECT r.id, (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(r)) WHERE key=ANY(ARRAY['id','order_id','owner_id','revision_number','signature_submission_id','snapshot_version','evidence_snapshot','document_hash','hash_algorithm','signer_name','signed_at_utc','signing_ip','signed_user_agent','created_at']))
  INTO item_id, item FROM public.order_authorization_evidence r
  WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.id=r.order_id AND o.owner_id=actor) AND r.owner_id=actor AND (p_after IS NULL OR r.id>p_after)
  ORDER BY r.id LIMIT 1;
 WHEN 'deletion_request' THEN
  SELECT r.user_id, (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(r)) WHERE key=ANY(ARRAY['user_id','requested_at','status']))
  INTO item_id, item FROM public.account_deletion_requests r
  WHERE r.user_id = actor AND (p_after IS NULL OR r.user_id>p_after)
  ORDER BY r.user_id LIMIT 1;
 ELSE RAISE EXCEPTION 'Invalid export section' USING ERRCODE='22023';
 END CASE;
 safe_item := signforth_private.export_redact(item);
 -- Preserve the exact PostgreSQL canonical bytes for independent evidence hash checks.
 -- Never include this extra text if redaction changed the snapshot.
 IF p_section='evidence' AND item IS NOT NULL THEN
  IF safe_item->'evidence_snapshot' IS DISTINCT FROM item->'evidence_snapshot' THEN
   RAISE EXCEPTION 'Evidence contains unsupported sensitive fields; export requires review';
  END IF;
  safe_item := safe_item || jsonb_build_object('evidence_snapshot_canonical', (item->'evidence_snapshot')::text);
 END IF;
 RETURN jsonb_build_object('version',1,'account_id',actor,'section',p_section,'record',safe_item,'next',item_id);
END;
$$;
REVOKE ALL ON FUNCTION public.signforth_export_account_page(text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.signforth_export_account_page(text,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
