-- READ ONLY after test uploads/signing. Aggregate totals only; no images or tokens.
begin read only;
select jsonb_build_object(
 'new_uploads_enabled',public.signforth_uploads_enabled(),
 'verified_objects',(select count(*) from signforth_private.uploads),
 'profiles_with_references',(select count(*) from public.contractor_profiles where logo_data_url like 'sfmedia:v1:%'),
 'orders_with_references',(select count(*) from public.orders where contractor_logo like 'sfmedia:v1:%' or photo_data like 'sfmedia:v1:%' or photo_data_2 like 'sfmedia:v1:%' or signature_data like 'sfmedia:v1:%'),
 'version_3_signed_evidence',(select count(*) from public.order_authorization_evidence where snapshot_version=3)
) as new_media_progress;
commit;
