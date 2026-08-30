-- FieldSign baseline schema.
-- Safe for both a fresh project and an existing prototype database.

begin;

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid default gen_random_uuid() primary key,
  order_type text default 'Change Order',
  contractor_company text not null,
  contractor_logo text,
  contractor_license text,
  contractor_phone text,
  contractor_email text,
  custom_terms text,
  project_title text not null,
  client_name text not null,
  client_phone text not null default '',
  description text not null,
  cost numeric(10, 2) not null,
  status text default 'pending',
  payment_status text default 'unpaid',
  payment_link text,
  photo_data text,
  photo_data_2 text,
  signature_data text,
  signed_at text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.orders enable row level security;

commit;
