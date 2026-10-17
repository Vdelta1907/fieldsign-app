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

// Uses only the previously selected unsigned test order. Never follows a checkout URL.
export function CheckoutClosureCheck(){
 const [busy,setBusy]=useState(false);
 const [token,setToken]=useState<string|null>(null);
 const [message,setMessage]=useState('Start while the test account is open. Keep this page open between checks. Do not sign or edit the test order.');
 async function run(blocked:boolean){
  setBusy(true);
  try{
   const identity=await supabase.auth.getUser();
   if(identity.error||identity.data.user?.id!==target) throw Error('Sign in with the selected disposable test account.');
   const access=await supabase.rpc('signforth_my_account_access_allowed');
   if(access.error||access.data!==!blocked) throw Error(blocked?'Pause the test account first.':'Reopen the test account first.');
   let signingToken=token;
   if(!blocked){
    setToken(null);
    const result=await supabase.from('orders').select('id,owner_id,status,payment_status,require_payment_upfront,signing_token,archived_at')
     .eq('id','9d1037cc-7bd7-4a5a-b959-cbfb17f89529').eq('owner_id',target).single();
    const order=result.data;
    if(result.error||!order||order.status!=='pending'||order.payment_status!=='unpaid'||order.require_payment_upfront!==false||order.archived_at!==null||!order.signing_token)
     throw Error('The original unsigned, unpaid test order could not be verified. Test stopped.');
    signingToken=order.signing_token;
   }
   if(!signingToken) throw Error('Run the open-account check first.');
   const result=await supabase.functions.invoke('create-checkout',{body:{signingToken}});
   const response=result.error && 'context' in result.error ? result.error.context : null;
   const body=response instanceof Response?await response.clone().json().catch(()=>null):null;
   const expectedStatus=blocked?403:409;
   const expectedMessage=blocked?'This account is unavailable.':'This order is not eligible for payment';
   if(!(response instanceof Response)||response.status!==expectedStatus||body?.error!==expectedMessage)
    throw Error('NOT CONFIRMED: unexpected checkout response. Do not continue or open any payment link.');
   if(!blocked) setToken(signingToken);
   setMessage(blocked?'PASS: checkout request denied because account access is blocked. Reopen the test account now.':'PASS: unsigned order is ineligible for checkout. Now pause the account using the signing-link test script, then run the blocked-account check here without refreshing.');
  }catch(error){setMessage(error instanceof Error?error.message:'Test could not finish.');}
  finally{setBusy(false);}
 }
 return <main className="auth-shell"><section className="auth-card">
  <h1>Checkout access check</h1>
  <p>This checks the checkout entry point with an unsigned order. It does not test payments or invalidate existing payment links.</p>
  <button className="btn-primary" disabled={busy} onClick={()=>void run(false)}>1. Check open account</button>
  <button className="btn-primary" disabled={busy||!token} onClick={()=>void run(true)}>2. Check blocked account</button>
  <p role="status" aria-live="polite">{message}</p>
  <a href="/">Return to SignForth</a>
 </section></main>;
}
