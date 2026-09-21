-- REFERENCE ONLY: supplied deployed trigger routines. Do not execute during deployment.
CREATE OR REPLACE FUNCTION public.fieldsign_protect_signed_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  mutable_fields text[] := array[
    'payment_status',
    'stripe_checkout_session_id',
    'stripe_payment_intent_id',
    'payment_link',
    'archived_at',
    'updated_at'
  ];
begin
  if OLD.status = 'signed' then
    if TG_OP = 'DELETE' then
      raise exception
        'Signed orders cannot be deleted. Archive the order instead.';
    end if;

    if (to_jsonb(NEW) - mutable_fields)
       is distinct from
       (to_jsonb(OLD) - mutable_fields)
    then
      raise exception
        'Signed authorization content cannot be changed.';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  return NEW;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.prevent_authorization_evidence_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception
    'Authorization evidence is immutable.';
end;
$function$
;
