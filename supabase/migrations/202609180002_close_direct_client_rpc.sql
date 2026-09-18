-- FINAL CUTOVER: deploy both Edge Functions and frontend before applying this file.
-- Old open tabs must reload. Do not replay the old baseline migrations.
begin;
revoke execute on function public.get_order_for_signing(uuid) from public, anon, authenticated;
revoke execute on function public.fieldsign_get_link_state(uuid) from public, anon, authenticated;
revoke execute on function public.fieldsign_submit_client_response_v2(uuid, text, text, uuid) from public, anon, authenticated;
commit;
