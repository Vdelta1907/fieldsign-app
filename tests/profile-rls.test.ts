// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

test('profile RLS and column grants isolate accounts and keep Stripe server-controlled', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select current_setting('test.uid',true)::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.contractor_profiles (
        user_id uuid primary key, company_name text, license_number text, phone text, email text,
        logo_data_url text, custom_terms text, require_payment_upfront boolean default false,
        stripe_account_id text, stripe_charges_enabled boolean default false,
        stripe_details_submitted boolean default false, updated_at timestamptz);
      grant all on public.contractor_profiles to authenticated;
      create policy permissive_legacy on public.contractor_profiles for all to authenticated using(true) with check(true);
      insert into public.contractor_profiles(user_id,company_name,stripe_account_id)
      values ('00000000-0000-0000-0000-000000000001','A','acct_a'),('00000000-0000-0000-0000-000000000002','B','acct_b');`);
    await db.exec(await readFile(new URL('../supabase/migrations/202609160001_account_profile_isolation.sql', import.meta.url), 'utf8'));
    await db.exec(`set role authenticated; set test.uid = '00000000-0000-0000-0000-000000000001';`);
    const rows = await db.query('select company_name from public.contractor_profiles');
    expect(rows.rows).toEqual([{ company_name: 'A' }]);
    await expect(db.exec(`update public.contractor_profiles set stripe_account_id='acct_b'`)).rejects.toThrow(/permission denied/);
    await expect(db.exec(`insert into public.contractor_profiles(user_id,stripe_charges_enabled) values ('00000000-0000-0000-0000-000000000003',true)`)).rejects.toThrow(/permission denied/);
    await db.exec(`update public.contractor_profiles set company_name='A edited' where user_id='00000000-0000-0000-0000-000000000001'`);
    await db.exec(`update public.contractor_profiles set company_name='Stolen' where user_id='00000000-0000-0000-0000-000000000002'`);
    await expect(db.exec(`update public.contractor_profiles set user_id='00000000-0000-0000-0000-000000000003'`)).rejects.toThrow(/row-level security/);
    await expect(db.exec('select * from public.account_deletion_requests')).rejects.toThrow(/permission denied/);
    await db.exec('reset role;');
    expect((await db.query(`select company_name from public.contractor_profiles where user_id='00000000-0000-0000-0000-000000000002'`)).rows).toEqual([{ company_name: 'B' }]);
  } finally { await db.close(); }
}, 30000);
