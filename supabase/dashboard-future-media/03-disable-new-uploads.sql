-- SAFE WRITE ROLLBACK: existing private images remain readable.
-- Keep this release's readers, database functions and frontend deployed.
begin;
update signforth_private.upload_settings set enabled=false where id;
select public.signforth_uploads_enabled() as new_private_uploads_enabled;
commit;
