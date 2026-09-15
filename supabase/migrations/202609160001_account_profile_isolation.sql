-- Apply only this new migration to the existing Gate 4 database.
-- Earlier SQL-editor changes are not fully represented by this repository.
begin;
alter table public.contractor_profiles add column if not exists use_default_terms boolean;
alter table public.contractor_profiles enable row level security;
revoke all on public.contractor_profiles from anon;
revoke insert, update on public.contractor_profiles from authenticated;
-- Revoke any column grants too before establishing the explicit whitelist.
do $$ declare c record; begin
  for c in select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'contractor_profiles'
  loop
    execute format('revoke insert (%I), update (%I) on public.contractor_profiles from authenticated', c.column_name, c.column_name);
  end loop;
end $$;
grant select on public.contractor_profiles to authenticated;
grant insert (user_id, company_name, license_number, phone, email, logo_data_url,
  custom_terms, use_default_terms, require_payment_upfront, updated_at)
  on public.contractor_profiles to authenticated;
grant update (user_id, company_name, license_number, phone, email, logo_data_url,
  custom_terms, use_default_terms, require_payment_upfront, updated_at)
  on public.contractor_profiles to authenticated;
-- Restrictive policy also constrains any pre-existing permissive policy.
drop policy if exists signforth_profile_account_boundary on public.contractor_profiles;
create policy signforth_profile_account_boundary on public.contractor_profiles
  as restrictive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create unique index if not exists signforth_one_owner_per_stripe_account
  on public.contractor_profiles(stripe_account_id) where stripe_account_id is not null;

create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'completed'))
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select, insert, update on public.account_deletion_requests to service_role;
commit;
