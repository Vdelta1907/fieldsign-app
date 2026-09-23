import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
const mock=vi.hoisted(()=>({upload:vi.fn(),insert:vi.fn()}));
vi.mock('../src/lib/privateUploads',()=>({uploadPrivateImage:(...args:any[])=>mock.upload(...args),resolvePrivateImages:async(_client:any,sources:any[])=>sources.map(s=>s||'')}));
vi.mock('../src/lib/supabase',()=>({supabase:{auth:{refreshSession:vi.fn(),signOut:vi.fn()}}}));
vi.mock('../src/lib/workspaceClient',()=>({createWorkspaceClient:(userId:string)=>{
 const channel={on:()=>channel,subscribe:()=>channel};
 return {from:(table:string)=>{
  const q:any={select:()=>q,eq:()=>q,abortSignal:()=>q,insert:(data:any)=>{mock.insert(data);return q;},
   single:async()=>({data:{id:'draft',status:'draft',client_name:'Client'},error:null}),
   maybeSingle:async()=>({data:table==='contractor_profiles'?{user_id:userId,company_name:'Company',custom_terms:''}:null,error:null})};return q;
 },rpc:()=>({abortSignal:async()=>({data:{orders:[],summary:{allCount:0,draftCount:0,pendingCount:0,signedCount:0,attentionCount:0,paidCount:0,totalApprovedRevenue:0,totalPaidRevenue:0},selected_count:0,has_more:false,next_cursor:null},error:null})}),
 channel:()=>channel,removeChannel:vi.fn(),functions:{invoke:async()=>({data:{user_id:userId,charges_enabled:false},error:null})}};
}}));
import App from '../src/App';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
test('real draft save waits for media, preserves entered details on failure, then saves references on retry',async()=>{
 vi.stubGlobal('scrollTo',vi.fn());vi.stubGlobal('alert',vi.fn());vi.spyOn(console,'error').mockImplementation(()=>{});
 mock.insert.mockReset();mock.upload.mockReset();mock.upload.mockRejectedValueOnce(new Error('Image upload interrupted'));
 render(<App session={{user:{id:'owner',email:'test@example.com'}} as any} clientToken={null} isCurrent={()=>true} onSession={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:/New Order/}));
 fireEvent.change(screen.getByPlaceholderText('Enter client’s name'),{target:{value:'Client'}});
 fireEvent.click(screen.getByRole('button',{name:/Save Draft & Exit/}));
 await waitFor(()=>expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Image upload interrupted')));
 expect(mock.insert).not.toHaveBeenCalled();expect((screen.getByPlaceholderText('Enter client’s name') as HTMLInputElement).value).toBe('Client');
 const ref='sfmedia:v1:'+'a'.repeat(64);
 mock.upload.mockImplementation(async(_client,source)=>source?ref:null);
 fireEvent.click(screen.getByRole('button',{name:/Save Draft & Exit/}));
 await waitFor(()=>expect(mock.insert).toHaveBeenCalledTimes(1));
 expect(mock.insert.mock.calls[0][0]).toMatchObject({client_name:'Client',owner_id:'owner',contractor_logo:ref,photo_data:null,photo_data_2:null});
 await screen.findByText('Tap any status category above to expand orders ▼');
});
