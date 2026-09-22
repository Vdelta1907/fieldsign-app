// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from 'vitest';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('dashboard pages are owner-scoped, ten at a time, newest-first, with complete totals beyond 1000 orders', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create table public.orders(id uuid primary key, owner_id uuid,status text,archived_at timestamptz,created_at timestamptz not null,
        order_type text,contractor_company text,contractor_license text,contractor_phone text,contractor_email text,custom_terms text,
        project_title text,client_name text,client_phone text,description text,cost numeric,cancelled_at timestamptz,cancellation_reason text,
        revision_number int,client_response_note text,client_responded_at timestamptz,last_sent_at timestamptz,payment_status text,
        require_payment_upfront boolean,signing_token uuid,signed_at timestamptz,signed_at_utc timestamptz,signer_name text,
        contractor_logo text,photo_data text,photo_data_2 text,signature_data text);
      alter table public.orders enable row level security;
      grant select on public.orders to authenticated;
      create policy owner_read on public.orders for select to authenticated using(owner_id=auth.uid());
      insert into public.orders(id,owner_id,status,created_at,cost,payment_status,contractor_logo)
      select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${uuid(9000)}',
        case when n<=14 then 'declined' when n<=27 then 'changes_requested' else 'pending' end,
        '2026-01-01'::timestamptz + n*interval '1 minute',2,'unpaid','large-logo-private'
      from generate_series(1,35) n;
      insert into public.orders(id,owner_id,status,created_at,cost,payment_status)
      select ('00000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,'${uuid(9000)}','signed',
        '2025-01-01',1,case when n<=7 then 'paid' else 'unpaid' end from generate_series(1,1001) n;
      insert into public.orders(id,owner_id,status,created_at,cost)
      select ('00000000-0000-4000-8000-'||lpad((n+2000)::text,12,'0'))::uuid,'${uuid(9000)}','draft','2024-01-01',5 from generate_series(1,17) n;
      insert into public.orders(id,owner_id,status,created_at,cost,archived_at) values
        ('${uuid(8000)}','${uuid(9001)}','signed','2027-01-01',99999,null),
        ('${uuid(8001)}','${uuid(9000)}','signed','2027-01-01',99999,now());`);
    await db.exec(readFileSync(new URL('../supabase/migrations/202609220001_dashboard_pagination.sql', import.meta.url), 'utf8'));
    const read = async (category: string | null, cursor: any = null) => (await db.query<{ page: any }>(
      'select public.signforth_dashboard_page($1,$2,$3) page', [category, cursor?.created_at ?? null, cursor?.id ?? null])).rows[0].page;
    await db.exec(`set role authenticated; set test.uid='${uuid(9000)}'`);
    const collapsed = await read(null);
    expect(collapsed.orders).toEqual([]);
    expect(collapsed.summary).toEqual({ allCount: 1053, draftCount: 17, pendingCount: 35, signedCount: 1001,
      attentionCount: 27, paidCount: 7, totalApprovedRevenue: 1001, totalPaidRevenue: 7 });
    const first = await read('active');
    expect(first.orders).toHaveLength(10);
    expect(first.orders.map((o: any) => o.id)).toEqual(Array.from({ length: 10 }, (_, i) => uuid(35 - i)));
    expect(first.summary).toEqual(collapsed.summary);
    expect(JSON.stringify(first)).not.toContain('large-logo-private');
    expect(Object.keys(first.orders[0])).not.toContain('contractor_logo');
    const pendingIds: string[] = []; let cursor = null;
    do {
      const page = await read('pending', cursor);
      expect(page.orders.length).toBeLessThanOrEqual(10);
      expect(page.selected_count).toBe(35);
      pendingIds.push(...page.orders.map((o: any) => o.id)); cursor = page.next_cursor;
      if (!page.has_more) { expect(cursor).toBeNull(); break; }
    } while (cursor);
    expect(pendingIds).toHaveLength(35); expect(new Set(pendingIds).size).toBe(35);
    const attention: any[] = []; cursor = null;
    do {
      const page = await read('attention', cursor); attention.push(...page.orders); cursor = page.next_cursor;
    } while (cursor);
    expect(attention).toHaveLength(27);
    expect(new Set(attention.map(o => o.status))).toEqual(new Set(['declined', 'changes_requested']));
    const signed1 = await read('signed'); const signed2 = await read('signed', signed1.next_cursor);
    expect(signed1.orders[0].id).toBe(uuid(1101));
    expect(signed2.orders[0].id).toBe(uuid(1091)); // tied timestamps use ID ordering
    expect(signed1.summary.signedCount).toBe(1001);
    await expect(read('unknown')).rejects.toThrow('Invalid dashboard category');
    await expect(read('active', { id: uuid(1) })).rejects.toThrow('Invalid dashboard cursor');
    await db.exec(`reset role; insert into orders(id,owner_id,status,created_at,cost) values('${uuid(5000)}','${uuid(9000)}','pending','2028-01-01',1); set role authenticated;`);
    const nextAfterInsert = await read('active', first.next_cursor);
    expect(nextAfterInsert.orders[0].id).toBe(uuid(25)); // no offset duplication after newer insertion
    await db.exec(`set test.uid='${uuid(9001)}'`);
    const other = await read('active'); expect(other.orders.map((o: any) => o.id)).toEqual([uuid(8000)]);
    expect(other.summary.allCount).toBe(1);
    await db.exec("set test.uid=''"); await expect(read('active')).rejects.toThrow('Sign in');
    await db.exec('reset role; set role anon'); await expect(read('active')).rejects.toThrow('permission denied');
  } finally { await db.close(); }
}, 30000);
