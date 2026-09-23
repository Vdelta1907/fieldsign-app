// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from 'vitest';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const consent = 'I agree to conduct this transaction electronically, confirm that I reviewed the scope and amount, and intend my electronic signature to authorize this record.';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

test('new references preserve legacy evidence, bind only own verified bytes, survive revisions, and sign atomically/idempotently', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
   grant usage on schema auth to authenticated;
   create schema extensions;
   create function extensions.digest(bytea,text) returns bytea language sql as $$ select sha256($1) $$;
   create schema storage;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id int,bucket_id text);`);
  const schema = JSON.parse(read('./fixtures/new-media-schema.json'));
  for (const table of schema.tables.filter((t: any) => t.schema === 'public')) {
   const columns = table.columns.map((c: any) => {
    const defaults: Record<string,string> = {uuid:'gen_random_uuid()',text:"''",boolean:'false',integer:'1',numeric:'0',jsonb:"'{}'::jsonb",inet:"'127.0.0.1'::inet",'timestamp with time zone':'now()'};
    return `"${c.name}" ${c.type}${c.not_null ? ` not null default ${defaults[c.type.split('(')[0]]}` : ''}`;
   });
   await db.exec(`create table public.${table.name}(${columns.join(',')});`);
   for (const c of table.constraints || []) if (!c.definition.startsWith('FOREIGN KEY')) await db.exec(`alter table public.${table.name} add constraint ${c.name} ${c.definition};`);
  }
  await db.exec('create unique index orders_submission_unique on orders(client_submission_id)');
  // Exact reviewed contracts, including original signing body and revision behavior.
  await db.exec(read('../supabase/reference/client-routines-before-gate4.sql'));
  await db.exec(read('../supabase/reference/signed-immutability-before-media.sql'));
  await db.exec(read('./fixtures/future-media-order-routines.sql'));
  await db.exec(`create trigger fieldsign_signed_order_immutable before update or delete on orders for each row execute function fieldsign_protect_signed_order();
    create trigger prevent_authorization_evidence_mutation before update or delete on order_authorization_evidence for each row execute function prevent_authorization_evidence_mutation();
    insert into auth.users values('${id(1)}'),('${id(2)}');
    select set_config('test.uid','${id(1)}',false);`);
  const insertOrder = async (n: number, logo: string, status = 'pending') => db.query(`insert into orders(id,owner_id,status,signing_token,signing_expires_at,
    order_type,contractor_company,project_title,client_name,client_phone,description,cost,revision_number,contractor_logo,payment_status)
    values($1,$2,$3,$4,now()+interval '1 day','Change Order','Company','Project','Client','555','Scope',10,1,$5,'unpaid')`, [id(n),id(1),status,id(n+100),logo]);
  const sign = (n: number, image: string, submission = id(n+200)) => db.query(`select * from fieldsign_sign_order_with_evidence($1,'Client',$2,$3,false,$4,'192.0.2.1','Browser')`,[id(n+100),image,consent,submission]);
  const legacyImage='data:image/png;base64,legacy';
  await insertOrder(10,legacyImage);
  await sign(10,legacyImage);
  const original=(await db.query('select to_jsonb(o) data from orders o where id=$1',[id(10)])).rows;
  const evidence=(await db.query('select to_jsonb(e) data from order_authorization_evidence e')).rows;
  await db.exec(read('../supabase/migrations/202609190001_private_signed_media.sql'));
  await db.exec(read('../supabase/migrations/202609230001_future_private_media.sql'));
  expect((await db.query('select signforth_uploads_enabled() enabled')).rows[0].enabled).toBe(false);
  await expect(db.query("select signforth_register_upload($1,$2,100,'image/png')",[id(1),hash('new')])).rejects.toThrow('not enabled');
  const installation=(await db.exec(read('../supabase/dashboard-future-media/01-check-installation.sql'))).flatMap(r=>r.rows).find((r:any)=>r.installation_checks) as any;
  expect(Object.values(installation.installation_checks).every(v=>v===true)).toBe(true);
  await db.exec(read('../supabase/dashboard-future-media/02-enable-new-uploads.sql'));
  const source='data:image/png;base64,new-media';
  const ref='sfmedia:v1:'+hash(source);
  await db.query("select signforth_register_upload($1,$2,$3,'image/png')",[id(1),hash(source),source.length]);
  await db.query("select signforth_register_upload($1,$2,$3,'image/png')",[id(1),hash(source),source.length]);
  await expect(db.query("select signforth_register_upload($1,$2,1,'image/png')",[id(1),hash(source)])).rejects.toThrow('differs');
  await expect(db.query('select signforth_resolve_uploads($1,$2)',[id(2),[ref]])).rejects.toThrow('not available');
  await expect(db.query("insert into contractor_profiles(user_id,company_name,logo_data_url) values($1,'Other',$2)",[id(2),ref])).rejects.toThrow('not available');
  await insertOrder(11,ref);
  const media=(await db.query<any>('select signforth_get_order_media($1) data',[id(111)])).rows[0].data;
  expect(media.contractor_logo).toBeNull();
  expect(media._media[0]).toMatchObject({sha256:hash(source),byteLength:source.length});
  expect((await db.query<any>('select signforth_get_order_media($1) data',[id(999)])).rows[0].data).toBeNull();
  const result=(await sign(11,ref)).rows[0];
  const repeat=(await sign(11,ref)).rows[0];
  expect(repeat).toMatchObject({...result,already_recorded:true});
  await expect(sign(11,ref,id(999))).rejects.toThrow('already used');
  const newEvidence=(await db.query<any>('select * from order_authorization_evidence where order_id=$1',[id(11)])).rows[0];
  expect(newEvidence.snapshot_version).toBe(3);
  expect(newEvidence.evidence_snapshot.contractor.displayed_logo).toEqual({sha256:hash(source),byte_length:source.length});
  expect(newEvidence.evidence_snapshot.signature.signature_sha256).toBe(hash(source));
  expect(newEvidence.document_hash).not.toBe(hash(ref));
  await expect(db.query("update orders set contractor_logo='changed' where id=$1",[id(11)])).rejects.toThrow();
  await expect(db.query('delete from order_authorization_evidence where order_id=$1',[id(11)])).rejects.toThrow();
  const replayContext=(await db.query<any>('select signforth_signature_upload_context($1,$2) data',[id(111),id(211)])).rows[0].data;
  expect(replayContext.existing_signature).toBe(ref);
  // Legacy inline orders continue to receive version-2 evidence with identical media hashes.
  await insertOrder(12,legacyImage); await sign(12,legacyImage);
  expect((await db.query<any>('select snapshot_version from order_authorization_evidence where order_id=$1',[id(12)])).rows[0].snapshot_version).toBe(2);
  expect((await db.query('select to_jsonb(o) data from orders o where id=$1',[id(10)])).rows).toEqual(original);
  expect((await db.query('select to_jsonb(e) data from order_authorization_evidence e where order_id=$1',[id(10)])).rows).toEqual(evidence);
  // Revision retains old reference without copying image strings or exposing the old token.
  await insertOrder(13,ref);
  await db.query("select fieldsign_start_revision($1,'Change requested')",[id(13)]);
  const revision=(await db.query<any>('select snapshot from order_revisions where order_id=$1',[id(13)])).rows[0].snapshot;
  expect(revision.contractor_logo).toBe(ref); expect(revision.signing_token).toBeUndefined();
  expect((await db.query<any>('select signforth_get_order_media($1) data',[id(113)])).rows[0].data).toBeNull();
  // Exercise the reviewed create/publish routines with compact references.
  const create = (submission: string, logo: string) => db.query<any>(`select fieldsign_create_order(
    p_client_submission_id=>$1,p_order_type=>'Change Order',p_contractor_company=>'Company',p_contractor_logo=>$2,
    p_contractor_license=>null,p_contractor_phone=>null,p_contractor_email=>null,p_custom_terms=>null,
    p_project_title=>'Project',p_client_name=>'Client',p_client_phone=>'555',p_description=>'Scope',p_cost=>10,
    p_photo_data=>$2,p_photo_data_2=>null,p_require_payment_upfront=>false) data`,[submission,logo]);
  const created=(await create(id(500),ref)).rows[0].data;
  expect(created.contractor_logo).toBe(ref);
  expect((await create(id(500),ref)).rows[0].data.id).toBe(created.id);
  await expect(create(id(501),'sfmedia:v1:'+'f'.repeat(64))).rejects.toThrow('not available');
  expect((await db.query<any>('select count(*)::int n from orders where client_submission_id=$1',[id(501)])).rows[0].n).toBe(0);
  const newSource=source+'changed'; const newRef='sfmedia:v1:'+hash(newSource);
  await db.query("select signforth_register_upload($1,$2,$3,'image/png')",[id(1),hash(newSource),newSource.length]);
  const draft=(await db.query<any>('select signing_token from orders where id=$1',[id(13)])).rows[0];
  await db.query(`select fieldsign_publish_revision(p_order_id=>$1,p_expected_signing_token=>$2,p_publish_submission_id=>$3,
    p_order_type=>'Change Order',p_contractor_company=>'Company',p_contractor_logo=>$4,p_contractor_license=>null,
    p_contractor_phone=>null,p_contractor_email=>null,p_custom_terms=>null,p_project_title=>'Project',p_client_name=>'Client',
    p_client_phone=>'555',p_description=>'New scope',p_cost=>15,p_photo_data=>$4,p_photo_data_2=>null,p_require_payment_upfront=>false)`,
    [id(13),draft.signing_token,id(502),newRef]);
  expect((await db.query<any>('select contractor_logo from orders where id=$1',[id(13)])).rows[0].contractor_logo).toBe(newRef);
  expect((await db.query<any>('select snapshot from order_revisions where order_id=$1',[id(13)])).rows[0].snapshot.contractor_logo).toBe(ref);
  await expect(db.query('update orders set owner_id=$1 where id=$2',[id(2),id(13)])).rejects.toThrow('not available');
  await db.query("insert into contractor_profiles(user_id,company_name,logo_data_url) values($1,'Company',$2)",[id(1),newRef]);
  expect((await db.query<any>('select snapshot from order_revisions where order_id=$1',[id(13)])).rows[0].snapshot.contractor_logo).toBe(ref);
  await insertOrder(14,ref);
  await db.query('update orders set signing_expires_at=now()-interval \'1 day\' where id=$1',[id(14)]);
  expect((await db.query<any>('select signforth_signature_upload_context($1,$2) owner',[id(114),id(214)])).rows[0].owner).toBeNull();
  await expect(sign(14,ref)).rejects.toThrow('expired');
  expect((await db.query<any>('select status from orders where id=$1',[id(14)])).rows[0].status).toBe('pending');
  for (const role of ['anon','authenticated']) {
   await db.exec(`set role ${role}`);
   await expect(db.query('select signforth_register_upload($1,$2,20,\'image/png\')',[id(1),hash('attack')])).rejects.toThrow('permission denied');
   await expect(db.query('select signforth_resolve_uploads($1,$2)',[id(1),[ref]])).rejects.toThrow('permission denied');
   await expect(db.query('select * from signforth_private.uploads')).rejects.toThrow('permission denied');
   await db.exec('reset role');
  }
  await db.exec(read('../supabase/dashboard-future-media/03-disable-new-uploads.sql'));
  expect((await db.query<any>('select signforth_get_order_media($1) data',[id(111)])).rows[0].data._media).toHaveLength(2);
 } finally { await db.close(); }
},30000);
