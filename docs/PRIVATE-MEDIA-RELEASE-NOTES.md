# SignForth — private media stage 1

Prepared September 20, 2026. **Locally validated, not deployed. Gate 4 remains in progress.**

## Result

Prepared signed orders can now return small image references through the existing public gateway and a new owner-verified PDF gateway. The browser fetches the exact original image strings from private Storage, checks their byte length and SHA-256, and supplies them to the existing receipt/PDF code. No signed row or authorization-evidence row is rewritten.

An administrator-only batch function copies at most five eligible signed orders per invocation. It verifies every uploaded/existing object before publishing a reference. Identical strings are shared only within the same contractor's Storage path. Existing objects are never overwritten by this worker. An incomplete run is resumable; unprepared fields retain their existing inline fallback. A failure to download/verify a published reference produces an error, not a substituted logo.

Private download URLs last 60 seconds. The frontend retries once with fresh authorization when a URL returns an expiry-like 400/401/403 response. Downloads are bounded by expected size, an 8 MB field maximum and a 20-second timeout. Verified strings can be reused in memory for two minutes, with an 8 MB cache bound per workspace client and separate public-link scopes. Each order/PDF read still obtains fresh gateway authorization. No localStorage, IndexedDB, Cache API or service-worker media cache was added.

## Changed existing files

- `src/App.tsx`: use the owner-verified signed-PDF reader; check workspace identity after asynchronous media reads. PDF rendering and styling remain unchanged.
- `src/lib/clientAuthorization.ts`: request the new media-capable order action and hydrate images; preserve response/state operations and rate-limit cooldowns.
- `supabase/functions/client-authorization/index.ts`: add rate-limited `order-media`; retain old `order` compatibility.
- `supabase/config.toml`: add the two new function settings. Both validate authorization inside their code.
- `tests/branding.test.ts`: verify a restored private copy embeds in a PDF with the same original dimensions.
- `README.md` and `START-HERE.md`: identify this release and its current deployment guide. Prior deployment instructions are retained as history.

All 64 files from the previous client-rate-limit source package remain present. Only the seven existing files listed above differ. The current app icon, contractor-logo resizing, CSS, iPhone header, elastic movement, signing/evidence routines, payments and email verification code remain unchanged.

## Added files

- `src/lib/orderMedia.ts`: private download verification, bounded memory reuse and owner read helper.
- `supabase/functions/_shared/order-media.ts`: exact-byte copy, read-back verification and temporary URL issuance.
- `supabase/functions/contractor-order-media/index.ts`: verify the signed-in user, enforce read budget and retrieve only their signed order.
- `supabase/functions/prepare-order-media/index.ts`: administrator-only, resumable copy batches.
- `supabase/migrations/202609190001_private_signed_media.sql`: private bucket, restrictive direct-client policy, RLS-protected manifest/progress tables and five service-only routines. Public link eligibility matches the reviewed previous read routine.
- `supabase/dashboard-private-media/`: three generated single-file functions and three read-only deployment checks.
- `supabase/reference/signed-immutability-before-media.sql`: supplied protection routines as reference/test fixtures; not a deployment migration.
- `scripts/build-private-media-dashboard.mjs`: regenerate the single-file Dashboard functions from canonical source.
- `tests/order-media.test.ts`, `tests/private-media-edge.test.ts`, `tests/private-media-db.test.ts`: media verification, retry/cache behavior, access boundaries, worker failure/idempotent retries and SQL privileges.
- `docs/PRIVATE-MEDIA-DEPLOYMENT.md`, these notes and the archived prior Gate 4 guide.

## Validation

- **55 tests passed across 15 test files**, including all previous regression tests.
- **Application TypeScript check and production build passed.** Build used harmless example public Supabase configuration so Vite included the full app rather than optimizing it away after the missing-configuration guard. Verified both new media routes appear in the generated bundle. No example credentials/configuration file is shipped as a production environment.
- **Edge Function TypeScript check passed** for the three affected functions, shared helpers, unchanged submit-signature and all three standalone Dashboard files, against installed Supabase types with minimal Deno declarations.
- **Lint: no errors; one pre-existing `unicorn/no-thenable` warning** in `tests/server-security.test.ts`.
- Vite warns about a bundle larger than 500 kB. This release does not change bundle splitting. Existing jsdom tests also print their scrollTo-not-implemented notices; tests pass.
- PGlite executes the migration and supplied protection routines, checking permissions, private storage policy behavior even alongside a broad permissive policy, owner isolation, signed/unsigned/expired/archived read behavior, unchanged originals/evidence, exact hashes, per-owner deduplication and repeat preparation. All three read-only deployment SQL files execute successfully in this fixture.
- Gateway tests use mocked Supabase transport; Storage tests verify exact uploads, read-back failures, duplicate responses and no-overwrite behavior. A real current app-logo string is restored and embedded by jsPDF.
- The generated Dashboard files are checked for exact equivalence to their source/helper composition.

These are local checks. Deno is not installed here, so the function check is not native `deno check`. No hosted Supabase deployment, real Storage integration, live browser/account isolation test, installed-iPhone test or simultaneous multi-connection worker test has been performed. PGlite uses one connection. The deployment guide includes the live checks required before recording completion.

## Scope and limits

This is the first read/copy stage for signed, unarchived orders. New/unsigned orders and signed orders created after the last preparation batch still use inline media until deliberately prepared. There is no new preparation cron job. The existing client-limit cleanup remains unchanged.

Original database strings remain the evidence baseline and rollback path. This does not reclaim their database space. Copies and downloads use Storage/transfer resources; moving bytes out of a database response does not eliminate egress. Short-lived in-memory reuse helps only applicable repeat reads. No percentage savings or hosted capacity result is claimed. The historical egress quota overage is not erased.

The administrative service role can manage Storage; this bucket is not a regulatory write-once archive. Ordinary client roles cannot directly read/write it, and the copying code never overwrites objects. The new private schema must be covered by database backups, and Storage object backup/recovery remains an operational Gate 4 item. Originals are retained to make this stage recoverable.

Pagination, future-upload storage/evidence changes, retention/export/deletion, broader operational hardening and other roadmap items remain open. The approved lowered-arrow wordmark remains a separate approved asset and is not substituted into historical orders or contractor branding.


## September 21 — preparation authorization correction

Hosted diagnostic: the JWT arrived with correct formatting and matching unverified role/project hints but did not equal the runtime service key. The original byte-equality authorization rule therefore rejected it. The reason for the credential difference is unconfirmed; decoded JWT claims were never accepted as proof.

The administrative preparer now requires a separate random 256-bit preparation secret (SIGNFORTH_MEDIA_PREPARATION_SECRET) through x-signforth-media-secret. Missing/malformed configuration fails closed with 503; missing/wrong caller secret gives 403 before database access. No legacy-JWT authorization fallback is retained. The built-in service key is used only for the server's database/Storage client. Other functions, frontend, migration and copy verification are unchanged.

Updated canonical/standalone preparer, auth tests and instructions; added blank local-secret template and PREPARATION-AUTH-FIX.md. Four new cases bring the suite to 55 passing tests; Edge source/standalone typechecks pass; lint retains its old warning. The unchanged frontend build result above remains applicable. No live successful batch is claimed. See the correction guide before retrying; do not repeat successful SQL steps.
