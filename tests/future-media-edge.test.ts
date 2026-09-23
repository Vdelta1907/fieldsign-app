// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, test, vi } from 'vitest';
import * as future from '../supabase/functions/_shared/future-media';
import * as media from '../supabase/functions/_shared/order-media';
import * as limits from '../supabase/functions/_shared/client-limits';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const owner='00000000-0000-4000-8000-000000000001';
const token='00000000-0000-4000-8000-000000000002';
const submission='00000000-0000-4000-8000-000000000003';
function fixture() {
 const registry=new Map<string,any>();
 const storage={upload:vi.fn(async()=>({error:null})),download:vi.fn(async()=>({data:new Blob([image]),error:null})),
   createSignedUrl:vi.fn(async()=>({data:{signedUrl:'https://example/private'},error:null}))};
 const rpc=vi.fn(async(name:string,args:any={})=>{
  if(name==='signforth_consume_client_limit') return {data:{allowed:true},error:null};
  if(name==='signforth_uploads_enabled') return {data:true,error:null};
  if(name==='signforth_signature_upload_context') return {data:{owner_id:owner},error:null};
  if(name==='fieldsign_sign_order_with_evidence') return {data:[{signed_at_utc:'2026-09-23',payment_status:'unpaid',already_recorded:true,document_hash:'original'}],error:null};
  if(name==='signforth_register_upload') {
   const ref='sfmedia:v1:'+args.p_hash;
   registry.set(ref,{reference:ref,field:'contractor_logo',sha256:args.p_hash,byteLength:args.p_bytes,path:owner+'/'+args.p_hash+'.txt'});
   return {data:ref,error:null};
  }
  if(name==='signforth_resolve_uploads') {
   const rows=args.p_sources.map((r:string)=>registry.get(r));
   return args.p_owner===owner && rows.every(Boolean) ? {data:rows,error:null} : {data:null,error:{message:'not available'}};
  }
  throw new Error(name);
 });
 const admin:any={rpc,storage:{from:()=>storage},auth:{getUser:vi.fn(async(jwt:string)=>({data:{user:jwt==='valid-user'?{id:owner}:null},error:null}))}};
 return {admin,storage,rpc,registry};
}
function handler(name:string,admin:any,standalone=false) {
 let run:any;
 const code=ts.transpileModule(readFileSync(new URL(standalone ? `../supabase/dashboard-future-media/${name}.ts` : `../supabase/functions/${name}/index.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText;
 vm.runInNewContext(code,{exports:{},Response,URL,crypto,TextEncoder,TextDecoder,atob,btoa,Uint8Array,DataView,console:{error:vi.fn()},Deno:{serve:(f:any)=>{run=f;},env:{get:()=> 'https://signforth.example'}},
 require:(id:string)=>id.includes('supabase-js')?{createClient:()=>admin}:id.includes('future-media')?future:id.includes('order-media')?media:limits});
 return (body:any,auth='Bearer valid-user')=>run(new Request('https://example',{method:'POST',body:JSON.stringify(body),headers:{authorization:auth,'content-type':'application/json','user-agent':'Browser','cf-connecting-ip':'192.0.2.1'}}));
}
test('uploads verify stored bytes before registration, reuse identical objects and never overwrite',async()=>{
 const {admin,storage,rpc}=fixture();
 const ref=await future.storeVerifiedUpload(admin,owner,image);
 expect(ref).toMatch(/^sfmedia:v1:[a-f0-9]{64}$/);
 expect(storage.upload.mock.calls[0][2]).toMatchObject({upsert:false,contentType:'text/plain'});
 const registration=rpc.mock.calls.findIndex(([name])=>name==='signforth_register_upload');
 expect(storage.download.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[registration]);
 expect(await future.storeVerifiedUpload(admin,owner,image)).toBe(ref);
 expect(storage.upload).toHaveBeenCalledTimes(1);
});
test('invalid formats and corrupt/replaced objects cannot publish references',async()=>{
 const {admin,storage,rpc}=fixture();
 for(const source of ['https://example/image','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YWJj','x'.repeat(1500001)])
  await expect(future.storeVerifiedUpload(admin,owner,source)).rejects.toThrow();
 expect(storage.upload).not.toHaveBeenCalled();
 storage.download.mockResolvedValue({data:new Blob(['wrong']),error:null});
 await expect(future.storeVerifiedUpload(admin,owner,image)).rejects.toThrow('verification failed');
 expect(rpc.mock.calls.some(([name])=>name==='signforth_register_upload')).toBe(false);
 storage.upload.mockResolvedValue({error:{statusCode:'500'}} as any);
 await expect(future.storeVerifiedUpload(admin,owner,image)).rejects.toThrow('upload failed');
});
test('owner endpoint denies invalid sessions, ignores supplied owner and resolves only verified own references',async()=>{
 const {admin,rpc,storage}=fixture();const invoke=handler('contractor-media',admin);
 expect((await invoke({action:'upload',source:image},'Bearer fake')).status).toBe(401);
 expect(rpc).not.toHaveBeenCalled();
 const response=await invoke({action:'upload',source:image,owner:'attacker'});
 expect(response.status).toBe(200); const {reference}=await response.json();
 expect(rpc.mock.calls.find(([name])=>name==='signforth_register_upload')?.[1].p_owner).toBe(owner);
 expect((await invoke({action:'resolve',sources:[reference]})).status).toBe(200);
 expect((await invoke({action:'resolve',sources:['sfmedia:v1:'+'f'.repeat(64)],owner})).status).toBe(404);
 expect(storage.upload).toHaveBeenCalledTimes(1);
});
test('disabled cutover retains inline behavior and performs no storage writes',async()=>{
 const {admin,rpc,storage}=fixture();const original=rpc.getMockImplementation()!;
 rpc.mockImplementation(async(name,args)=>name==='signforth_uploads_enabled'?{data:false,error:null}:original(name,args));
 const response=await handler('contractor-media',admin)({action:'upload',source:image});
 expect(await response.json()).toEqual({reference:image});expect(storage.upload).not.toHaveBeenCalled();
});
test('signature upload is token-authorized and passes a verified reference with the original retry identity',async()=>{
 const {admin,rpc,storage}=fixture();const invoke=handler('submit-signature',admin);
 const request={signingToken:token,submissionId:submission,signerName:'Client',signatureData:image,consentText:'existing consent',paymentRequested:false};
 expect((await invoke(request)).status).toBe(200);
 const args=rpc.mock.calls.find(([name])=>name==='fieldsign_sign_order_with_evidence')?.[1];
 expect(args).toMatchObject({p_token:token,p_submission_id:submission,p_signature_data:expect.stringMatching(/^sfmedia:v1:/)});
 expect((await invoke(request)).status).toBe(200);expect(storage.upload).toHaveBeenCalledTimes(1);
 const original=rpc.getMockImplementation()!;
 rpc.mockImplementation(async(name,args)=>name==='signforth_signature_upload_context'?{data:null,error:null}:original(name,args));
 expect((await invoke(request)).status).toBe(400);expect(storage.upload).toHaveBeenCalledTimes(1);
});

test('standalone Dashboard deployments execute upload/signing and hydrate the legacy public read',async()=>{
 const {admin,rpc}=fixture();
 const upload=await handler('contractor-media',admin,true)({action:'upload',source:image});
 expect(upload.status).toBe(200);const {reference}=await upload.json();
 const result=await handler('submit-signature',admin,true)({signingToken:token,submissionId:submission,signerName:'Client',signatureData:image,consentText:'consent',paymentRequested:false});
 expect(result.status).toBe(200);
 const original=rpc.getMockImplementation()!;
 const sha=reference.slice(11);
 rpc.mockImplementation(async(name,args)=>{
  if(name==='get_order_for_signing') return {data:[{contractor_logo:reference}],error:null};
  if(name==='signforth_get_order_media') return {data:{id:token,contractor_logo:null,_media:[{field:'contractor_logo',sha256:sha,byteLength:image.length,path:owner+'/'+sha+'.txt'}]},error:null};
  return original(name,args);
 });
 const response=await handler('client-authorization',admin,true)({action:'order',signingToken:token});
 expect(await response.json()).toEqual({data:[{id:token,contractor_logo:image}]});
});
