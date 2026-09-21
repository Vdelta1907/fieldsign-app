-- READ ONLY. Run after the new migration; every check must be true.
select jsonb_build_object(
  'bucket_is_private', coalesce((select not public from storage.buckets where id='signforth-order-media-v1'),false),
  'storage_rls_enabled', (select relrowsecurity from pg_class where oid='storage.objects'::regclass),
  'blocking_storage_policy_present', exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='signforth_private_media_no_direct_client_access' and permissive='RESTRICTIVE'),
  'manifest_rls_enabled', (select relrowsecurity from pg_class where oid='signforth_private.order_media'::regclass),
  'signed_protection_enabled', exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.orders'::regclass and p.proname='fieldsign_protect_signed_order' and t.tgenabled in ('O','A')),
  'evidence_protection_enabled', exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.order_authorization_evidence'::regclass and p.proname='prevent_authorization_evidence_mutation' and t.tgenabled in ('O','A')),
  'limiter_installed', to_regprocedure('public.signforth_consume_client_limit(text,text)') is not null,
  'old_public_rpc_still_closed', not has_function_privilege('anon','public.get_order_for_signing(uuid)','execute')
    and not has_function_privilege('authenticated','public.get_order_for_signing(uuid)','execute'),
  'all_media_rpcs_service_only', (select count(*)=5 and bool_and(
    not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')
    and has_function_privilege('service_role',p.oid,'execute') and p.prosecdef)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('signforth_next_media_order','signforth_register_order_media',
      'signforth_finish_media_order','signforth_media_progress','signforth_get_order_media'))
) as installation_checks;
