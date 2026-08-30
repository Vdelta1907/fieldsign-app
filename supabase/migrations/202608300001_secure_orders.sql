-- FieldSign production security foundation.
-- Run this in Supabase before deploying the matching frontend.

begin;

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists owner_id uuid references auth.users(id) on delete restrict,
  add column if not exists signing_token uuid not null default gen_random_uuid(),
  add column if not exists signing_expires_at timestamptz not null default (now() + interval '30 days'),
  add column if not exists require_payment_upfront boolean not null default false,
  add column if not exists signer_name text,
  add column if not exists consent_text text,
  add column if not exists signed_at_utc timestamptz,
  add column if not exists signed_user_agent text,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists orders_signing_token_key
  on public.orders (signing_token);

create index if not exists orders_owner_created_idx
  on public.orders (owner_id, created_at desc)
  where archived_at is null;

alter table public.orders alter column owner_id set default auth.uid();

alter table public.orders drop constraint if exists orders_cost_positive;
alter table public.orders add constraint orders_cost_positive check (cost > 0) not valid;
alter table public.orders drop constraint if exists orders_status_valid;
alter table public.orders add constraint orders_status_valid
  check (status in ('pending', 'signed')) not valid;
alter table public.orders drop constraint if exists orders_payment_status_valid;
alter table public.orders add constraint orders_payment_status_valid
  check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded')) not valid;
alter table public.orders drop constraint if exists orders_order_type_valid;
alter table public.orders add constraint orders_order_type_valid
  check (order_type in ('Change Order', 'New Job Agreement')) not valid;

drop policy if exists "Allow public insert" on public.orders;
drop policy if exists "Allow public select" on public.orders;
drop policy if exists "Allow public update" on public.orders;
drop policy if exists "Allow public delete" on public.orders;
drop policy if exists "Contractors can view their orders" on public.orders;
drop policy if exists "Contractors can create their orders" on public.orders;
drop policy if exists "Contractors can update pending orders" on public.orders;

revoke all on table public.orders from anon;
grant select, insert, update on table public.orders to authenticated;

create policy "Contractors can view their orders"
on public.orders for select to authenticated
using (owner_id = auth.uid());

create policy "Contractors can create their orders"
on public.orders for insert to authenticated
with check (owner_id = auth.uid());

create policy "Contractors can update pending orders"
on public.orders for update to authenticated
using (owner_id = auth.uid() and status = 'pending')
with check (owner_id = auth.uid() and status = 'pending');

create or replace function public.get_order_for_signing(p_token uuid)
returns table (
  id uuid,
  order_type text,
  contractor_company text,
  contractor_logo text,
  contractor_license text,
  contractor_phone text,
  contractor_email text,
  custom_terms text,
  project_title text,
  client_name text,
  client_phone text,
  description text,
  cost numeric,
  status text,
  payment_status text,
  require_payment_upfront boolean,
  photo_data text,
  photo_data_2 text,
  signature_data text,
  signer_name text,
  signed_at_utc timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    o.id, o.order_type, o.contractor_company, o.contractor_logo,
    o.contractor_license, o.contractor_phone, o.contractor_email,
    o.custom_terms, o.project_title, o.client_name, o.client_phone,
    o.description, o.cost, o.status, o.payment_status,
    o.require_payment_upfront, o.photo_data, o.photo_data_2,
    o.signature_data, o.signer_name, o.signed_at_utc, o.created_at
  from public.orders o
  where o.signing_token = p_token
    and o.archived_at is null
    and (o.status = 'signed' or o.signing_expires_at > now())
  limit 1;
$$;

create or replace function public.sign_order(
  p_token uuid,
  p_signer_name text,
  p_signature_data text,
  p_consent_text text,
  p_user_agent text,
  p_payment_requested boolean default false
)
returns table (signed_at_utc timestamptz, payment_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_signed_at timestamptz := now();
  v_payment_status text := case when p_payment_requested then 'pending' else 'unpaid' end;
begin
  if nullif(trim(p_signer_name), '') is null or char_length(p_signer_name) > 120 then
    raise exception 'A valid signer name is required';
  end if;

  if p_signature_data not like 'data:image/png;base64,%'
     or octet_length(p_signature_data) > 750000 then
    raise exception 'A valid signature is required';
  end if;

  if nullif(trim(p_consent_text), '') is null then
    raise exception 'Electronic consent is required';
  end if;

  update public.orders
  set status = 'signed',
      signature_data = p_signature_data,
      signer_name = trim(p_signer_name),
      consent_text = p_consent_text,
      signed_at_utc = v_signed_at,
      signed_user_agent = left(coalesce(p_user_agent, ''), 512),
      payment_status = v_payment_status,
      updated_at = v_signed_at
  where signing_token = p_token
    and status = 'pending'
    and archived_at is null
    and signing_expires_at > v_signed_at;

  if not found then
    raise exception 'This signing link is invalid, expired, or already used';
  end if;

  return query select v_signed_at, v_payment_status;
end;
$$;

create or replace function public.archive_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.orders
  set archived_at = now(), updated_at = now()
  where id = p_order_id and owner_id = auth.uid() and archived_at is null;

  if not found then
    raise exception 'Order not found';
  end if;
end;
$$;

revoke all on function public.get_order_for_signing(uuid) from public;
revoke all on function public.sign_order(uuid, text, text, text, text, boolean) from public;
revoke all on function public.archive_order(uuid) from public;
grant execute on function public.get_order_for_signing(uuid) to anon, authenticated;
grant execute on function public.sign_order(uuid, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.archive_order(uuid) to authenticated;

commit;

-- Existing prototype rows intentionally remain unowned and inaccessible.
-- After the first contractor signs in, an administrator can assign safe legacy
-- rows with: update public.orders set owner_id = '<auth user uuid>' where owner_id is null;
