-- CUTOVER: run only AFTER deploying all three Edge Functions and the updated frontend.
-- This enables future writes; it does not migrate, delete or rewrite existing media.
begin;
update signforth_private.upload_settings set enabled=true where id;
select public.signforth_uploads_enabled() as new_private_uploads_enabled;
commit;
