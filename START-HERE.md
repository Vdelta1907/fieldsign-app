# SignForth — Gate 4 client rate limits

This is the complete source package for the existing reviewed SignForth deployment. The iPhone layout, elastic dashboard, contractor workflows, styling, payments, and authorization evidence logic are retained. No production changes have been made by preparing this ZIP.

**This release requires staged Supabase changes as well as the frontend deployment. Do not deploy the frontend alone, replay old migrations, or run a blanket database push.** The archive's historical migrations do not reproduce all of the newer deployed evidence/revision schema.

## What changed

- Added the supplied `submit-signature` Edge Function source, with a shared server-side rate check and bounded request body. Signing still calls the existing evidence routine with the same submission ID, consent, signature, payment selection, and network evidence. The database still creates the timestamp/hash and handles duplicate submissions.
- Added `client-authorization`, a narrow gateway for order reads, link-state reads, and client responses. The React app uses this gateway in place of three direct RPC calls.
- Added private, atomic PostgreSQL counters and service-only limiter/cleanup functions. The counter RPC commits before a business operation starts, so a failed business operation does not erase its attempt.
- Added a final permission migration removing anon/authenticated/PUBLIC access to the three former direct RPC routes. Their bodies remain unchanged. Legacy signing methods remain revoked.
- Added readable 429 wait messages, exposed `Retry-After`, and frontend polling cooldowns. Submission IDs remain intact after failures or throttling.
- Added automated database, gateway, and frontend recovery tests. Updated this document and the README.

## Limits and scope

All budgets are fixed one-minute windows controlled by the server:

| Scope | Read requests | Write attempts |
| --- | ---: | ---: |
| Per signing token | 120/minute | 10/minute |
| Whole project | 60,000/minute | 3,000/minute |

Order and state reads share the read budget. Signing and client responses share the write budget. Different browser tabs using the same link share its budget. The existing 3-second and 5-second polls remain unchanged and normally fit comfortably within the read budget. At a minute boundary, fixed windows can permit two windows' allowance close together; this is not a sliding-window limiter. Successful retries still consume budget and may need to wait, but retain their original submission ID and database result.

Counters store SHA-256 token digests, never raw signing tokens, signatures, passwords, names, or IP addresses. Token casing cannot reset a budget. Project ceilings also bound downstream work when an attacker rotates tokens; saturation can temporarily affect legitimate callers too. These initial ceilings are engineering defaults, not a verified 1,000-user load-test result.

A missing/unavailable limiter returns 503 and does not run the protected operation. Oversized bodies return 413 (800,000 bytes for signatures; 16,384 for the client gateway). JSON bodies are read with a byte bound even without Content-Length. Existing database validation remains authoritative.

This is application-level protection, not a promise against distributed denial-of-service attacks or Edge invocation charges. Invalid requests rejected before the limiter still reach the Edge gateway. We do not use unverified caller-controlled IP headers as rate-limit identities. The signing function's existing `cf-connecting-ip` evidence behavior is preserved; deployed gateway trust still needs verification. No CAPTCHA, Auth setting, paid service, Stripe webhook, checkout, contractor-only endpoint, or unrelated styling has changed.

## Deployment — in this order

Use a staging copy with the current deployed schema where available. Save a database backup/current routine grants and keep the previous frontend and signing-function version available. Reference copies of the four supplied deployed routines are in `supabase/reference/client-routines-before-gate4.sql`; **do not execute that reference file**.

1. In the correct Supabase project, run **only** `supabase/migrations/202609180001_client_rate_limits.sql` once in the SQL editor. It creates private counters and gives the service role access to the three reviewed client routines; it does not yet remove existing public access. If any referenced routine is missing or differs from the reviewed deployment, stop and reconcile that mismatch instead of replaying old migrations.
2. Deploy `client-authorization` and `submit-signature`, including `_shared/client-limits.ts`. Both function configurations require `verify_jwt = false` because public clients hold signing-link tokens, not contractor accounts. The functions restrict accepted operations and the database validates the signing token. Keep the existing `APP_URL`, `SUPABASE_URL`, and server-only `SUPABASE_SERVICE_ROLE_KEY`. Do not put the service key in frontend/Vercel VITE variables. No new secrets are required.
3. Verify both gateway endpoints work with a test order. In the Supabase CLI, deploying by name includes the shared import:

   ```sh
   supabase functions deploy client-authorization
   supabase functions deploy submit-signature
   ```

   `supabase/config.toml` contains the two JWT settings. If editing in the Dashboard instead, include the shared file and verify the matching configuration there. Deploying only the index file is insufficient.
4. Upload the contents of this source folder to the repository root on the existing working branch, replacing matching files. Commit and let Vercel finish deploying. Preserve existing environment variables. Suggested commit message:

   `Add shared rate limits for client authorization and close direct RPC bypasses`

5. Confirm the new frontend loads an order, polls its state, signs a test order, and records a client response. Then apply **only** `supabase/migrations/202609180002_close_direct_client_rpc.sql` in the SQL editor. This is the security cutover: until it is applied, direct RPC bypasses remain available. Existing open tabs running the old frontend must reload.
6. Run the post-cutover checks below. Keep Gate 4 marked in progress until live checks pass.
7. Schedule `select public.signforth_cleanup_client_limits();` daily using the project's existing trusted database scheduler (for example Supabase Cron if already available), or run it as maintenance until scheduling is configured. The limiter also deletes up to 100 rows older than two minutes per valid request. Without scheduled maintenance, idle-project counters may remain longer than two minutes. No scheduler or extension is silently enabled by these migrations.

## Post-cutover checks

Use test orders and avoid quota-heavy production traffic:

- A client without a contractor login can open an active link, submit a response, and sign. Contractor account isolation remains intact.
- Retrying a successful signature/response with the same submission ID returns the original successful result. Confirm the signature timestamp and evidence hash do not change.
- A closed, expired, cancelled, superseded, or archived link retains its existing behavior. Normal polling still detects state changes.
- Direct REST RPC attempts under anon **and** authenticated credentials are denied for `get_order_for_signing`, `fieldsign_get_link_state`, and `fieldsign_submit_client_response_v2`. The service role can call them through the Edge gateway. Legacy signing routes remain revoked.
- A controlled write burst on one test link returns 429 with Retry-After after the allowance. Wait for the next minute and retry. Confirm the UI shows the wait message and preserves the submission ID. Do not intentionally exhaust the whole-project ceiling on production.
- Verify independent clients cannot each receive a fresh per-token allowance; perform a multi-connection staging concurrency check before declaring capacity ready.
- Confirm the iPhone layout/elastic dashboard and Stripe payment continuation still work normally. No repeated payment should be created by retrying a signature.
- Confirm database cleanup is scheduled and monitor 429/503 responses. Check the existing Supabase Usage warning separately; this release does not resolve the unidentified quota overage.

## Rollback

If rollback is necessary after final cutover, restore the original public permissions **before** rolling back the frontend, then restore the prior frontend and signing function:

```sql
begin;
grant execute on function public.get_order_for_signing(uuid) to anon, authenticated;
grant execute on function public.fieldsign_get_link_state(uuid) to anon, authenticated;
grant execute on function public.fieldsign_submit_client_response_v2(uuid, text, text, uuid) to anon, authenticated;
commit;
```

This intentionally restores the previous direct-access behavior and its rate-limit gap. Do not grant PUBLIC or re-enable legacy signing functions. The new counter table can remain; no business data migration needs undoing.

## Local validation

```sh
npm ci
npm test
npm run build
npm run lint
```

Validation for this package: 36 tests across 12 files pass; TypeScript and production build pass; lint reports only the existing `unicorn/no-thenable` warning in `tests/server-security.test.ts`. The two changed/new Edge Functions and shared helper also pass a separate TypeScript check against the installed Supabase types with a minimal Deno ambient declaration. Deno itself is not installed in this workspace, so this is not a native `deno check` or hosted integration run.

Tests exercise actual PostgreSQL functions/permissions via PGlite, gateway handlers with mocked Supabase transport, signature argument/result preservation, streamed body bounds, limiter failure/429 handling, and browser cooldown recovery. PGlite is single-connection and does not prove hosted multi-connection behavior or production throughput. Existing workflow/UI tests remain included. Hosted deployment, real-device checks of this release, and production evidence writes have not been performed.

Gate 4 remains in progress: public client-route rate limiting is prepared here; broader contractor endpoint abuse controls, Auth/CAPTCHA integration, gateway IP trust verification, private storage, pagination, retention/export/deletion, monitoring/recovery, and other checkpoint items are not certified complete by this ZIP. CAPTCHA is currently off and leaked-password protection is disabled in the supplied screenshots. Do not enable CAPTCHA without its frontend integration.

The prior iPhone-specific release instructions are retained as history in `docs/iphone-status-bar-checkpoint.md`.
