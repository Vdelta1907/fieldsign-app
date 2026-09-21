-- READ ONLY. Run before copying, save the result, then repeat after copying.
-- Compare during a quiet interval without creating/signing orders or changing records.
-- Returns counts/digests only; no names, images, tokens or document contents.
begin read only;
set local statement_timeout = '30s';
select jsonb_build_object(
  'signed_count', (select count(*) from public.orders where status='signed'),
  'signed_originals_digest', (select encode(sha256(convert_to(coalesce(string_agg(
    id::text || ':' || encode(sha256(convert_to((to_jsonb(o) - array[
      'payment_status','stripe_checkout_session_id','stripe_payment_intent_id','payment_link','archived_at','updated_at'
    ])::text,'UTF8')),'hex'), '|' order by id),''),'UTF8')),'hex') from public.orders o where status='signed'),
  'evidence_count', (select count(*) from public.order_authorization_evidence),
  'evidence_digest', (select encode(sha256(convert_to(coalesce(string_agg(
    encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex'), '|' order by to_jsonb(e)::text),''),'UTF8')),'hex')
    from public.order_authorization_evidence e)
) as original_record_check;
commit;
