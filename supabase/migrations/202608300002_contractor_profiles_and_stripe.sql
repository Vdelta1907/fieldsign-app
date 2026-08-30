begin;

create table if not exists public.contractor_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null default 'FieldSign Contractor',
  license_number text,
  phone text,
  email text,
  logo_data_url text,
  custom_terms text,
  require_payment_upfront boolean not null default false,
  stripe_account_id text unique,
  stripe_charges_enabled boolean not null default false,
  stripe_details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contractor_profiles enable row level security;
revoke all on table public.contractor_profiles from anon;
grant select, insert, update on table public.contractor_profiles to authenticated;

drop policy if exists "Contractors can view their profile" on public.contractor_profiles;
drop policy if exists "Contractors can create their profile" on public.contractor_profiles;
drop policy if exists "Contractors can update their profile" on public.contractor_profiles;

create policy "Contractors can view their profile"
on public.contractor_profiles for select to authenticated
using (user_id = auth.uid());

create policy "Contractors can create their profile"
on public.contractor_profiles for insert to authenticated
with check (user_id = auth.uid());

create policy "Contractors can update their profile"
on public.contractor_profiles for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

alter table public.orders
  add column if not exists stripe_checkout_session_id text unique,
  add column if not exists stripe_payment_intent_id text;

drop function if exists public.get_order_for_signing(uuid);
create function public.get_order_for_signing(p_token uuid)
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
  payments_enabled boolean,
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
    o.require_payment_upfront,
    coalesce(p.stripe_charges_enabled, false) as payments_enabled,
    o.photo_data, o.photo_data_2, o.signature_data, o.signer_name,
    o.signed_at_utc, o.created_at
  from public.orders o
  left join public.contractor_profiles p on p.user_id = o.owner_id
  where o.signing_token = p_token
    and o.archived_at is null
    and (o.status = 'signed' or o.signing_expires_at > now())
  limit 1;
$$;

revoke all on function public.get_order_for_signing(uuid) from public;
grant execute on function public.get_order_for_signing(uuid) to anon, authenticated;

commit;
