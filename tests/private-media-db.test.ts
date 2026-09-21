// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from 'vitest';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = 'data:image/png;base64,' + 'a'.repeat(10000);
const hash = createHash('sha256').update(source).digest('hex');
test('private copies preserve originals, enforce access and deduplicate per owner', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id int,bucket_id text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated;
      grant all on storage.objects to anon,authenticated;
      create policy broad_client_policy on storage.objects for all to anon,authenticated using(true) with check(true);
      create table public.orders(id uuid primary key,owner_id uuid,status text,archived_at timestamptz,created_at timestamptz default now(),
        signing_token uuid,signing_expires_at timestamptz,contractor_logo text,photo_data text,photo_data_2 text,signature_data text,
        order_type text,contractor_company text,contractor_license text,contractor_phone text,contractor_email text,custom_terms text,
        project_title text,client_name text,client_phone text,description text,cost numeric,payment_status text,require_payment_upfront boolean,
        signer_name text,signed_at timestamptz,signed_at_utc timestamptz,document_hash text,evidence_snapshot jsonb);
      create table public.contractor_profiles(user_id uuid,stripe_charges_enabled boolean);
      create table public.order_authorization_evidence(id uuid, document_hash text, evidence_snapshot jsonb);`);
    await db.exec(readFileSync(new URL('../supabase/reference/signed-immutability-before-media.sql', import.meta.url), 'utf8'));
    await db.exec(`create trigger immutable_signed before update or delete on public.orders for each row execute function public.fieldsign_protect_signed_order();
      create trigger immutable_evidence before update or delete on public.order_authorization_evidence for each row execute function public.prevent_authorization_evidence_mutation();
      insert into public.order_authorization_evidence values('${id(1)}','original-hash','{"signed":"original"}');`);
    const evidenceBefore = (await db.query('select * from order_authorization_evidence')).rows;
    for (let n = 1; n <= 6; n++) {
      await db.query(`insert into orders(id,owner_id,status,signing_token,signing_expires_at,contractor_logo,document_hash,evidence_snapshot,archived_at)
        values($1,$2,$3,$4,now()+$5::interval,$6,'original-hash','{"signed":"original"}', $7)`,
      [id(n), id(n === 3 ? 12 : 11), n >= 4 && n <= 5 ? 'pending' : 'signed', id(n + 100), n === 5 || n === 1 ? '-1 day' : '1 day', source, n === 6 ? '2026-01-01' : null]);
    }
    const before = (await db.query('select * from orders order by id')).rows;
    const fingerprintSql = readFileSync(new URL('../supabase/dashboard-private-media/00-original-fingerprints.sql', import.meta.url), 'utf8');
    const fingerprintsBefore = (await db.exec(fingerprintSql)).find(result => result.rows.length)?.rows;
    await db.exec(`create function public.get_order_for_signing(uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
      revoke all on function public.get_order_for_signing(uuid) from public,anon,authenticated;
      create function public.signforth_consume_client_limit(text,text) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
    await db.exec(readFileSync(new URL('../supabase/migrations/202609190001_private_signed_media.sql', import.meta.url), 'utf8'));
    const installation = await db.exec(readFileSync(new URL('../supabase/dashboard-private-media/01-check-installation.sql', import.meta.url), 'utf8'));
    expect(Object.values((installation[0].rows[0] as any).installation_checks).every(value => value === true)).toBe(true);
    const read = async (token: string | null, order: string | null = null, owner: string | null = null) =>
      (await db.query<{ result: any }>('select signforth_get_order_media($1,$2,$3) result', [token, order, owner])).rows[0].result;
    const register = (n: number, digest = hash, field = 'contractor_logo') => db.query(
      'select signforth_register_order_media($1,$2,$3,$4)', [id(n), field, digest, source.length]);
    const finish = (n: number) => db.query('select signforth_finish_media_order($1)', [id(n)]);
    expect((await read(id(101))).contractor_logo).toBe(source);
    await expect(register(1, 'a'.repeat(64))).rejects.toThrow('verification failed');
    await expect(register(1, hash, 'owner_id')).rejects.toThrow('Invalid media field');
    await expect(register(4)).rejects.toThrow('Only signed');
    await expect(finish(1)).rejects.toThrow('incomplete');
    for (const n of [1, 2, 3]) { await register(n); await register(n); await finish(n); await finish(n); }
    const signed = await read(id(101));
    expect(signed.contractor_logo).toBeNull();
    expect(signed._media).toEqual([{ field: 'contractor_logo', sha256: hash, byteLength: source.length, path: `${id(11)}/${hash}.txt` }]);
    expect(JSON.stringify(signed).length).toBeLessThan(source.length / 5);
    expect((await read(id(102)))._media[0].path).toBe(signed._media[0].path);
    expect((await read(id(103)))._media[0].path).not.toBe(signed._media[0].path);
    expect(await read(null, id(1), id(12))).toBeNull();
    expect((await read(null, id(1), id(11))).id).toBe(id(1));
    expect(await read(id(105))).toBeNull(); // expired unsigned
    expect(await read(id(106))).toBeNull(); // archived
    expect(await read(id(999))).toBeNull(); // invalid/revoked link
    expect((await read(id(104))).contractor_logo).toBe(source); // unchanged pending path
    await expect(read(id(101), id(1), id(11))).rejects.toThrow('Invalid media access context');
    expect((await db.query<{ result: any }>('select signforth_media_progress() result')).rows[0].result).toEqual({ remaining: 0, prepared: 3, references: 3, unique_objects: 2 });
    expect((await db.query('select * from orders order by id')).rows).toEqual(before);
    expect((await db.exec(fingerprintSql)).find(result => result.rows.length)?.rows).toEqual(fingerprintsBefore);
    await db.exec(readFileSync(new URL('../supabase/dashboard-private-media/02-check-progress.sql', import.meta.url), 'utf8'));
    await expect(db.exec(`update orders set contractor_logo='changed' where id='${id(1)}'`)).rejects.toThrow('cannot be changed');
    expect((await db.query('select * from order_authorization_evidence')).rows).toEqual(evidenceBefore);
    await expect(db.exec("delete from order_authorization_evidence")).rejects.toThrow('immutable');
    await db.exec(`insert into storage.objects values(1,'signforth-order-media-v1'),(2,'other-bucket');`);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await expect(read(id(101))).rejects.toThrow('permission denied');
      await expect(register(1)).rejects.toThrow('permission denied');
      await expect(finish(1)).rejects.toThrow('permission denied');
      await expect(db.exec('select signforth_next_media_order();')).rejects.toThrow('permission denied');
      await expect(db.exec('select signforth_media_progress();')).rejects.toThrow('permission denied');
      await expect(db.exec('select * from signforth_private.order_media')).rejects.toThrow('permission denied');
      expect((await db.query('select * from storage.objects')).rows).toEqual([{ id: 2, bucket_id: 'other-bucket' }]);
      await expect(db.exec("insert into storage.objects values(3,'signforth-order-media-v1')")).rejects.toThrow('row-level security');
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    expect((await read(id(101))).id).toBe(id(1));
  } finally { await db.close(); }
}, 30000);
