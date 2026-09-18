// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from 'vitest';

const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
test('database budgets persist across business failures, expire, and cannot be bypassed by public RPC calls', async () => {
  const db = new PGlite();
  const tokenHash = 'a'.repeat(64);
  const consume = (kind = 'write', hash = tokenHash) => db.query<{ result: { allowed: boolean; retry_after: number } }>(
    'select public.signforth_consume_client_limit($1, $2) as result', [kind, hash]);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create function public.get_order_for_signing(uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
      create function public.fieldsign_get_link_state(uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
      create function public.fieldsign_submit_client_response_v2(uuid,text,text,uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
      grant execute on all functions in schema public to anon, authenticated;`);
    await db.exec(migration('202609180001_client_rate_limits'));
    await db.exec(`set role service_role;`);
    expect((await consume()).rows[0].result.allowed).toBe(true);
    await expect(db.exec(`select 1/0`)).rejects.toThrow();
    await db.exec('reset role;');
    expect((await db.query<{ hits: number }>(`select hits from signforth_private.request_limits where bucket = $1`, ['write:' + tokenHash])).rows[0].hits).toBe(1);
    // Future fixture windows avoid a wall-clock minute boundary resetting seeded limits.
    await db.exec(`update signforth_private.request_limits set hits = 10, window_start = clock_timestamp() + interval '1 minute' where bucket = 'write:${tokenHash}';`);
    expect((await consume()).rows[0].result).toMatchObject({ allowed: false });
    expect((await consume()).rows[0].result.retry_after).toBeGreaterThan(0);
    expect((await consume('read')).rows[0].result.allowed).toBe(true);
    expect((await consume('write', 'b'.repeat(64))).rows[0].result.allowed).toBe(true);
    await db.exec(`update signforth_private.request_limits set window_start = clock_timestamp() - interval '2 minutes';`);
    expect((await consume()).rows[0].result.allowed).toBe(true);
    await db.exec(`update signforth_private.request_limits set hits = 3000, window_start = clock_timestamp() + interval '1 minute' where bucket = 'project:write';`);
    expect((await consume('write', 'c'.repeat(64))).rows[0].result.allowed).toBe(false);
    expect((await db.query(`select * from signforth_private.request_limits where bucket = $1`, ['write:' + 'c'.repeat(64)])).rows).toHaveLength(0);
    await db.exec('truncate signforth_private.request_limits;');
    const burst = await db.query<{ result: { allowed: boolean } }>(
      `select public.signforth_consume_client_limit('write', repeat('d',64)) as result from generate_series(1,16)`);
    expect(burst.rows.filter(row => row.result.allowed)).toHaveLength(10);
    await db.exec('truncate signforth_private.request_limits;');
    const polling = await db.query<{ result: { allowed: boolean } }>(
      `select public.signforth_consume_client_limit('read', repeat('e',64)) as result from generate_series(1,40)`);
    expect(polling.rows.every(row => row.result.allowed)).toBe(true);
    await expect(consume('anything')).rejects.toThrow('Invalid rate-limit request');
    await expect(consume('write', 'raw-token')).rejects.toThrow('Invalid rate-limit request');
    await db.exec(migration('202609180002_close_direct_client_rpc'));
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role};`);
      await expect(consume()).rejects.toThrow(/permission denied/);
      await expect(db.exec('select * from signforth_private.request_limits')).rejects.toThrow(/permission denied/);
      await expect(db.exec('select public.get_order_for_signing(null)')).rejects.toThrow(/permission denied/);
      await expect(db.exec('select public.fieldsign_get_link_state(null)')).rejects.toThrow(/permission denied/);
      await expect(db.exec('select public.fieldsign_submit_client_response_v2(null,null,null,null)')).rejects.toThrow(/permission denied/);
      await db.exec('reset role;');
    }
    await db.exec('set role service_role; select public.get_order_for_signing(null); select public.fieldsign_get_link_state(null); select public.fieldsign_submit_client_response_v2(null,null,null,null); reset role;');
    await db.exec(`update signforth_private.request_limits set window_start = clock_timestamp() - interval '2 days';
      set role service_role; select public.signforth_cleanup_client_limits(); reset role;`);
    expect((await db.query('select * from signforth_private.request_limits')).rows).toHaveLength(0);
  } finally { await db.close(); }
}, 30000);
