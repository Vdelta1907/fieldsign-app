import {useState} from 'react';
import {supabase} from '../lib/supabase';
const target='2d62fc94-2215-426d-9b9e-946e7700deb0';
const checks=[
 {name:'Account settings',route:'account-security',body:{action:'closure-check'}},
 {name:'Uploaded media',route:'contractor-media',body:{action:'closure-check'}},
 {name:'Order media',route:'contractor-order-media',body:{orderId:'invalid-test-id'}},
 {name:'Order cancellation',route:'cancel-order',body:{orderId:'invalid-test-id'}},
 {name:'Stripe connection status',route:'stripe-connect-onboard',body:{action:'status'}},
];
export function ClosureCheck(){
 const [busy,setBusy]=useState(false);
 const [lines,setLines]=useState<string[]>([]);
 async function run(){
  setBusy(true);setLines([]);
  try{
   const {data,error}=await supabase.auth.getUser();
   if(error||data.user?.id!==target) throw Error('Sign in with the selected disposable test account.');
   const access=await supabase.rpc('signforth_my_account_access_allowed');
   if(access.error||access.data!==false) throw Error('The test account must be temporarily blocked before running this check.');
   let passed=0;
   for(const check of checks){
    // Recheck identity for each request, including after a switch in another tab.
    const current=await supabase.auth.getUser();
    if(current.error||current.data.user?.id!==target) throw Error('Session changed. Test stopped.');
    const {error:failure}=await supabase.functions.invoke(check.route,{body:check.body});
    const response=failure && 'context' in failure ? failure.context : null;
    let denied=false;
    if(response instanceof Response && response.status===403){
     const body=await response.clone().json().catch(()=>null);
     denied=body?.error==='This account is unavailable.';
    }
    if(denied) passed++;
    setLines(previous=>[...previous,`${denied?'PASS':'NOT CONFIRMED'}: ${check.name}${denied?' blocked.':'. Do not treat this route as passed.'}`]);
   }
   setLines(previous=>[...previous,`${passed} of ${checks.length} server access checks passed. Reopen the test account using the prepared SQL file.`]);
  }catch(error){setLines(previous=>[...previous,error instanceof Error?error.message:'Test could not finish.']);}
  finally{setBusy(false);}
 }
 return <main className="auth-shell"><section className="auth-card">
  <h1>Disposable account access check</h1>
  <p>This checks five signed-in server routes. It does not test signing links, payment links, or complete account deletion.</p>
  <button className="btn-primary" disabled={busy} onClick={()=>void run()}>{busy?'Checking access…':'Run server access checks'}</button>
  <div role="status" aria-live="polite">{lines.map((line,i)=><p key={i}>{line}</p>)}</div>
  <a href="/">Return to SignForth</a>
 </section></main>;
}
