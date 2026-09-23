-- READ ONLY. Every returned check must be true BEFORE enabling new uploads.
begin read only;
select jsonb_build_object(
 'writes_disabled',not public.signforth_uploads_enabled(),
 'bucket_private',exists(select 1 from storage.buckets where id='signforth-order-media-v1' and not public),
 'registry_rls',exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='signforth_private' and c.relname='uploads' and c.relrowsecurity),
 'anon_registration_denied',not has_function_privilege('anon','public.signforth_register_upload(uuid,text,integer,text)','EXECUTE'),
 'user_registration_denied',not has_function_privilege('authenticated','public.signforth_register_upload(uuid,text,integer,text)','EXECUTE'),
 'user_raw_resolve_denied',not has_function_privilege('authenticated','public.signforth_resolve_uploads(uuid,text[])','EXECUTE'),
 'service_registration_allowed',has_function_privilege('service_role','public.signforth_register_upload(uuid,text,integer,text)','EXECUTE'),
 'ordinary_user_registry_write_denied',not has_table_privilege('authenticated','signforth_private.uploads','INSERT,UPDATE,DELETE'),
 'signed_guard_enabled',exists(select 1 from pg_trigger where tgrelid='public.orders'::regclass and tgname='fieldsign_signed_order_immutable' and tgenabled='O'),
 'evidence_guard_enabled',exists(select 1 from pg_trigger where tgrelid='public.order_authorization_evidence'::regclass and tgname='prevent_authorization_evidence_mutation' and tgenabled='O')
) as installation_checks;
commit;
