# SignForth project checkpoint

## Baseline and sources

SignForth is the current product name. FieldSign is the former name, not a separate app.

The working baseline is the existing prototype plus the latest installed-iPhone status-bar fix and elastic dashboard work. The user confirmed that the iPhone layout finally looks better. Preserve that fix when making subsequent updates.

Sources reconciled here:

- Original `FieldSign_Remaining_Work_Tracker.docx`, dated September 3, 2026. Its checkboxes describe that earlier checkpoint, not the current completion state.
- Retrieved history of the original `SignForth™️` conversation, including later gate closeouts and user test feedback.
- Current workspace source and this conversation's latest changes and tests.
- Newly supplied app icon and SignForth wordmark. Original files are preserved unchanged in `work/project-reference/` along with the tracker.

This is a continuity record, not a fresh production security audit. Historical passes remain credited. An item is not newly certified merely because source code exists.

## Product and working agreements

Mobile contractor authorization for Change Orders and New Job Agreements: scope, price, photos, voice dictation, native SMS handoff, zero-account client review/signing, change requests/declines, revisions, receipts, and optional Stripe payment.

Preserve speed and usability while strengthening evidence, security, and reliability. Preserve functioning behavior and styling unless the active change requires otherwise. Deliver complete updated source ZIPs with current upload instructions, commit message, and relevant validation results. Do not repeat completed gates or skip their remaining requirements. Retest passed workflows when a change affects them. Track nonblocking observations separately from active security, payment, data-integrity, and core-workflow blockers.

Launch capacity target: at least 1,000 active contractors, validated with realistic workload tests. Historical planning discussed 20,000–30,000 monthly orders and headroom above the target; these are planning assumptions, not measured current capacity. Infrastructure upgrades should occur when necessary near launch, with current plan requirements verified at that time.

## Assigned roles

The user explicitly assigned these five roles for ongoing SignForth collaboration:

- Technical Lead: guide architecture, implementation, testing, and technical priorities.
- DevOps: guide deployments, environments, monitoring, backups, and recovery.
- Security Specialist: evaluate account isolation, authorization, data protection, abuse prevention, and security testing.
- Customer Support Lead: improve onboarding, help content, error messages, troubleshooting, and support workflows.
- Growth Marketer: guide positioning, acquisition, activation, retention, and pricing experiments.

Apply these perspectives together while preserving the approved roadmap and distinguishing recommendations from verified results. These roles do not by themselves authorize external communications, spending, or production changes. Gate 4 resumed September 18, 2026, beginning with existing server-side rate limiting and abuse protection.

## Gate status

| Gate | Original scope | Reconciled status |
| --- | --- | --- |
| 1 | Workflow completion | Recorded passed in prior history, including cancellation addendum. |
| 2 | Authorization evidence | Recorded passed in subsequent history. |
| 3 | Payment lifecycle | Formally recorded passed in prior history. |
| 4 | Security and data foundation | Active; completed security/account work is credited, remaining foundation work stays open. |
| 5 | Product readiness | Not formally closed. Some UI and device fixes were implemented early. |
| 6 | Commercial launch infrastructure | Not formally started/closed in recovered history. |

### Gates 1 through 3

Retain credit for workflow completion, revision history, retired-link handling, duplicate/concurrency protection, server-side evidence capture and hashes, protected authorization snapshots, activity records, payment separation, webhook truth, and completed payment/onboarding tests.

The original Gate 3 checklist explicitly includes processing and refunded scenarios. A broad historical gate-pass statement should not substitute for specific evidence if a later payment change affects those paths. Do not reopen all tests simply because this document was old.

### Gate 4 Security and data foundation

Original checklist and reconciliation:

- Tighten row-level security: database permissions/RLS lockdown was recorded passed; later profile/account isolation work was implemented and tested.
- Validate sensitive order-status transitions server-side: existing RPC/Edge protections were recorded; preserve them and inspect the deployed definitions before changing their contracts.
- Rate-limit public signing and response endpoints: implemented and deployed; user reported completing the rollout and all requested tests on September 18. Includes order/link-state reads, final RPC permission restrictions and cleanup setup. This is user-reported live verification, not an independently observed production audit or capacity test.
- Migrate contractor profiles from device-only storage: owner-linked profiles and account isolation implemented; explicit onboarding-complete state remains unverified.
- Move logos, photos, and signatures into private object storage with protected references, thumbnails, and appropriate signed access: remaining.
- Add dashboard pagination and bounded queries: remaining.
- Establish backup, retention, export, and deletion rules: remaining as a complete operational system. A deletion-request UI is not a completed deletion/retention process.
- Add production monitoring and structured errors: remaining.

Later approved operational additions: separate staging and production, version-controlled database changes, rollback and restoration procedures, secret review, and measured capacity testing. Keep these linked to the relevant Gate 4 and launch closeout work rather than duplicating implementation tasks.

Next planned Gate 4 work: private media storage for logos, photos and signatures, beginning with a read-only inventory and a migration plan that preserves existing signed evidence/hashes and receipts. First identify the resource behind the visible Supabase organization quota warning from the Usage page; do not assume an upgrade is necessary. Public-route rate limiting need not be repeated absent a relevant regression. Other Auth/abuse and operational gaps remain tracked separately.

### Gate 5 Product readiness

Original requirements still requiring formal closeout:

1. Cross-platform regression: iPhone Safari and installed app, Android Chrome and installed app, tablet, desktop; signing, revisions, payments, SMS, PDFs, and accounts.
2. Slow, interrupted, and recovered connections: clear progress, safe retries, no duplicate submissions or silent data loss.
3. Accessibility/usability: keyboard, focus, touch targets, contrast, labels, screen readers, and understandable errors.
4. Final icon/logo package: iOS, Android, PWA, favicon, and maskable assets using the supplied artwork.
5. Counsel review: consent, authorization terms, privacy, retention, contractor responsibilities, payments, and exclusions.
6. Final founder walkthrough as a new contractor and multiple client scenarios.

Later approved SF-010: Install SignForth card/button on contractor dashboard and Settings, hidden when installed and on preview deployments; supported Android prompt and guided iPhone flow. Keep it off client authorization pages. Do not cache sensitive orders, signatures, PDFs, authentication, or payment data. Offline drafts remain a separate post-launch item.

Recent dashboard/account improvements count toward readiness, but do not close the entire gate.

### Gate 6 Commercial launch infrastructure

1. Define subscription plans, limits, trials, and feature entitlements.
2. Implement SignForth subscription billing separately from contractor-to-client payments and Stripe Connect.
3. Account billing, cancellation, export, and deletion controls with documented record handling.
4. Production domain, support channel, policies, and onboarding help.
5. Privacy-conscious funnel/conversion and retention analytics without sensitive order content.
6. Public launch site and SEO emphasizing fast mobile change orders, zero-account authorization, native texting, dictation, and job-site evidence.

Pricing remains a proposal: Starter $19/month plus 1% capped at $15 per paid transaction; Pro $39/month plus 0.5%; Premium $79/month with no SignForth transaction fee. The user proposed a seven-day Pro trial; the prior assistant suggested fourteen days and revisiting the cap imbalance. Those recommendations were not a final pricing decision. Payment processor fees are a separate question. The stated business ambition is $1 million in monthly revenue, not a forecast.

## Rebrand and supplied assets

Use SignForth for current user-facing branding. The supplied `app-icon.png` is the app-icon source; `SignForth.png` is the supplied wordmark artwork, pending final placement/asset preparation. They are different from the smaller icon currently bundled with the prototype; originals have been retained.

Initial source scan found legacy FieldSign text in browser/Home Screen titles, contractor fallback labels, a client authorization label, configuration errors, package metadata, and documentation. The full branding pass must also inspect PDFs, messages, and install assets.

Do not globally replace all `fieldsign` strings. Database RPC names, migration history, storage/cache keys, deployed URLs, and existing signed evidence may be compatibility contracts. User-facing renaming and technical identifier migrations are separate scopes. Preserve existing signed records and evidence hashes. Preserve the new opaque iPhone status-bar metadata.

## Post-launch work from the original tracker

- Multiple reusable terms templates.
- Offline drafts and secure synchronization.
- Sign on This Device in-person handoff.
- Optional enhanced identity verification for selected high-risk/high-value work.
- Automated business SMS after monetization justifies its cost.
- Teams and scoped permissions.
- Advanced reporting, search, exports, accounting/CRM integrations, and portfolio activity.

Prelaunch contractor record export remains a Gate 4/6 requirement; advanced reporting/export capabilities do not defer that obligation.

## Latest local validation record

The iPhone status-bar package passed 25 tests across nine test files, TypeScript and production build, and lint with one pre-existing warning. Local browser checks verified locked dashboard/independent order scrolling. These results cover that package, not every planned launch requirement. The user subsequently confirmed improved physical-iPhone appearance.

## Deferred issue log

The September 19 consolidated handoff recovers SF-001 through SF-010 (SF-008 is accepted behavior). See SignForth-Handoff-Reconciliation.md for the register, current source evidence, and unresolved status differences. Do not assume every historical issue remains open or that this register exhausts all earlier observations.

## September 18 Gate 4 resumption

Local endpoint inventory completed; see `SignForth-Gate4-audit-notes.md`. No application changes or deployments. The deployed `submit-signature` source is missing from the package, as are newer database routine definitions. A read-only SQL inventory is prepared in `SignForth-Gate4-read-only-audit.sql`. Next inputs: deployed signing function plus imports, database inventory results, and actual Supabase Auth limits/bot-protection settings. Do not reconstruct missing signed-evidence logic or replay old migrations.

### Signing source received

The user supplied submit-signature; its unchanged reference is in `work/project-reference/deployed-functions/submit-signature.ts`. It calls `fieldsign_sign_order_with_evidence` with a service-role client. No explicit rate limiter or body-size cap appears in the wrapper. SQL inventory results and Auth rate-limit/bot-protection settings are still pending. Preserve existing signing evidence and response contracts.

### Database inventory received

Parsed 18 deployed public routines and preserved their definitions/privileges. Evidence signing is service-role-only; legacy signing/response methods have no execution rights for the three application roles. Active response and link-read RPCs remain publicly callable with bearer signing tokens and show no explicit rate limiter. Signing uses a row lock and successful-submission replay handling with the existing evidence hash. Authentication rate-limit and CAPTCHA settings remain the next input. No code or production changes yet.

### Authentication screenshots received — September 18

All requested Auth screenshots have now been supplied, superseding the pending-input notes above. Observed limits: emails 2/hour/project, SMS 30/hour/project, refresh 150/5 minutes/IP, verification 30/5 minutes/IP, anonymous sign-ins 30/hour/IP, sign-ups/sign-ins and Web3 each 30/5 minutes/IP. IP Address Forwarding is off. CAPTCHA is off; leaked-password protection is marked DISABLED. No settings changed.

Gate 4 implementation remains pending: protect signing and direct client-response/read routes while preserving evidence, retries and polling. Do not enable CAPTCHA before frontend integration. Separately, Supabase warns of restrictions from October 6, 2026 if the organization remains over quota; the resource responsible has not been identified. See the audit notes for details. No new ZIP or app changes in this audit phase.


## September 18 — client rate-limit implementation prepared

Supersedes earlier notes saying implementation is pending. The complete local source package is now `SignForth-Gate4-client-rate-limits.zip`, with ordered rollout/rollback instructions in its START-HERE.md and the standalone `SignForth-Gate4-Deployment.md`. Release notes list every changed/added file. No live deployment or Supabase setting change has occurred.

Implemented: private atomic PostgreSQL counters checked in a separate transaction; 120 reads and 10 writes per signing token per fixed minute, shared project ceilings 60,000/3,000; narrow client gateway; bounded bodies; final-cutover public RPC revocation; readable 429 recovery and polling cooldowns. Signing/response submission IDs and existing evidence routine bodies are preserved. Token digests only are stored. Opportunistic cleanup removes up to 100 counters older than two minutes per request; daily idle cleanup must be scheduled at deployment.

Validation: 36 tests in 12 files pass; app TypeScript/build and separate Edge source TypeScript check pass; lint has only the existing no-thenable warning. No native Deno runtime or hosted multi-connection test was available. Other 49 source files from the prior ZIP are byte-for-byte unchanged.

Next step: staged deployment following the new instructions, then live permissions/retry/polling/evidence checks and cleanup scheduling. The first migration deliberately leaves direct RPC access until the gateway/frontend are deployed; protection is not complete until the second migration revokes it. Do not run all historical migrations. No fresh-database bootstrap is claimed. Contractor-only endpoint controls, CAPTCHA, leaked-password protection, gateway IP trust, quota warning, and other roadmap items remain unresolved. Gate 4 is still in progress; Gates 1–3 remain credited.


### Dashboard deployment assistance

User requested detailed browser-based rollout instructions and clarification of the outputs folder. The original Gate 4 source ZIP is unchanged. Additional files in outputs/SignForth-Gate4-Dashboard-Files provide standalone client-authorization.ts and submit-signature.ts for pasting into each Supabase function index.ts. They inline the identical shared helper, removing only its local import, and passed separate TypeScript validation and the eight gateway tests (the original test source was restored afterward). check-permissions.sql is a read-only final-cutover check. These supplemental files are for the Supabase editor, not replacements for the source ZIP's GitHub layout. No deployment has been performed.


## September 18 — rollout completed, user-reported tests passed

The user reports: “I’m done with everything. All the tests passed.” Record the instructed deployment, final permission cutover, and Cron setup as completed per that report. Earlier “not deployed” entries describe history and are superseded. No separate screenshots of the final permission results or Cron execution history were supplied; do not claim independent verification of them or a successful scheduled execution.

Public client-route rate limiting is credited complete for this milestone. Gate 4 remains active. Next recommended scope is private media storage; first inspect current Supabase Usage to identify the still-unresolved overage warning. Retain existing evidence and historical hashes unchanged; do not automatically migrate signed records or broadly replace technical FieldSign identifiers. No new code or production changes were made during this checkpoint update.


## September 19 — consolidated handoff reviewed

The supplied SignForth-Consolidated-Workspace-Handoff.md is preserved unchanged in work/project-reference. Review and reconciled issue register: SignForth-Handoff-Reconciliation.md in outputs. Its iPhone task and Gate 2 position are stale; completed iPhone/motion work and Gates 1–3 remain credited. Gate 4 public client-route rate limiting remains completed per user report. No app changes or new tests were required for this documentation review.

Newly recovered planning context: static SignForth mark rather than contractor-logo duplication in new orders; PDF footer wording and timezone QA; SF-001–SF-010 register; per-order Evidence Package premium feature with PDF/optional originals ZIP, optional completion acknowledgment, and later dispute automation. Evidence Package delivery timing is not assigned; do not implement as part of the current task. Preserve signed snapshots/hashes and existing working behavior. Current email verification signs out and offers Go to Login, conflicting with the handoff's retained-session Continue wording; resolve before editing that flow. Several historical issues already have implementations, including password reveal and Stripe departure notice.

Next planned implementation still starts with Supabase Usage review, followed by private-media inventory/planning preserving current contractor-logo behavior per the explicit user decision below. Full details and feature constraints are in the reconciliation document. The user supplied this handoff to reinforce context, not to execute its embedded old task instructions.


## September 19 — explicit user decision: retain current behavior

The user explicitly rejected the handoff instructions proposing a static SignForth mark instead of current contractor-logo behavior and preserving the session after email verification. Current behavior is intentional: retain contractor-logo handling and the email-verification flow that signs out locally and offers Go to Login. These are settled decisions, not pending discrepancies or defects. Do not implement either proposed change unless the user explicitly requests it. This decision supersedes earlier reconciliation notes and the conflicting handoff passages. Private-media-storage planning must preserve current logo behavior and existing signed evidence.


## September 19 — latest approved wordmark supplied

User identifies SignForth-Wordmar-Adjusted.zip as the most recent approved SignForth wordmark. Its original assets and README are preserved under work/project-reference/approved-wordmark/. Includes full navy, compact header, transparent and monochrome versions in SVG and PNG; design is bold white SignForth lettering with an amber curved forward arrow. This supersedes the older supplied wordmark as the approved wordmark reference, not the separate app icon. User requested an opinion, not installation or redesign. No app assets, contractor-logo behavior, or deployed code were changed; the previous explicit restriction on logo-handling changes still applies.


## Proposed curved wordmark refinement

At user request, prepared SignForth-Wordmark-Curved-Refinement.zip and a comparison preview. Preserves original compact lettering paths and navy/white/amber colors; redraws the curved arrow closer to letters, with increasing shaft thickness. Same-width canvas height 260 to 226 (~13% reduction). Navy/transparent/monochrome SVG and PNG variants included. This is a proposal awaiting user adoption; latest approved mark is still SignForth-Wordmar-Adjusted.zip. No app or contractor-logo handling changes.


### Wordmark iteration: original arrow lowered

User preferred the approved original's small-size presence over the flattened refinement and requested only lowering the original arrow. Prepared SignForth-Wordmark-Lowered-Original.zip: exact original compact arrow path with translate(0 10), identical lettering/colors, top canvas trimmed ten units (260 to 250 height). Comparison deliberately keeps identical canvas/letter positions for judging arrow placement. Original arrow geometry and lettering equality verified programmatically; preview visually checked. Still a proposal, not adopted or installed.


## September 19 — lowered original arrow APPROVED

User explicitly approved the lowered-original-arrow wordmark and requested replacing the original. Current approved master is now outputs/SignForth-Approved-Wordmark.zip, mirrored in work/project-reference/approved-wordmark. Previous original assets are archived in work/project-reference/wordmark-before-lowered-arrow-approval. This supersedes all earlier proposed/pending-adoption notes and SignForth-Wordmar-Adjusted.zip as the current wordmark. Original compact arrow geometry, progressive thickness and lettering are unchanged; only arrow position is lowered ten units. All four named variants share this approved geometry. No app/deployment or contractor-logo behavior changes were made.


## September 19 — quota resource identified from Usage screenshots

IMG_7862 and IMG_7863 show organization-wide (All projects) current billing cycle August 28–September 28, 2026. Egress 9.714 / 5 GB (194%); detail rounds to 9.71 GB used and 4.71 GB over. Database size 0.182 / 0.5 GB (36%); Realtime peak connections 4/200; Edge invocations 609/500000; MAU 7/50000; Realtime messages119/2000000. Banner explicitly names prior-cycle Egress Exceeded and grace ending October 6, with possible402 responses if restricted. Current-cycle usage is separately over allowance. Chart shows concentration in early September, with largest spikes around Sept4 and Sept6 and much smaller visible bars later; exact dates/service/project attribution need tooltip and project filter.

Egress is the identified quota; no evidence yet attributes all of it to SignForth, inline images, a specific endpoint, or the recently deployed limiter. Current dashboard order-list select excludes photo_data, photo_data_2, signature_data and contractor_logo; it is unpaginated. Detailed order/client/PDF reads still include media. Do not claim dashboard repeatedly downloads full image rows. Supabase official Manage Egress usage docs confirm organization/project filters, per-date service breakdown, and that optimizations affect future traffic only, not already accrued usage. Moving files into Storage still incurs download egress; assess request frequency/size as well.

Next requested evidence: select SignForth_dev in the All projects dropdown and hover the largest early-September chart bars for their per-service breakdown. No upgrade, code change or production mutation performed.


## September 19 — spike service breakdown received

IMG_7864: Sept4 PostgREST3.488GB (rounded100%), Auth56.79KB, Realtime365.583KB. IMG_7865: Sept6 PostgREST3.128GB (rounded100%), Auth92.365KB, Realtime304.97KB, Functions6.228KB. Combined PostgREST6.616GB, roughly68% of displayed9.71GB period total. Project selector is outside these crops, so do not newly certify project filtering. This attributes spikes to database API responses, not a specific endpoint, media field or caller. Current source cannot establish behavior of historical Sept4/6 deployments. No evidence of attack is established.

Prepared SignForth-Gate4-Media-Inventory.sql: read-only transaction,20s timeout, aggregate order/profile media string sizes, bucket visibility, storage policies, evidence/media column metadata. No raw image/signature/token/customer content. This is an inventory for private-storage planning, not historical traffic attribution or a migration. Await execution output in the SignForth project; no production or source changes made.


## September 19 — live media inventory received

Preserved parsed output in work/project-reference/media-inventory-20260919.json. Orders70, signed51; photo1 648170 bytes, photo2 726902, signatures279838, contractor logos116430274. Combined media strings118085184 bytes; logos98.60% of measured fields. Largest one-order combined media2784138bytes. Profiles5, combined logo_data_url0bytes. No Storage buckets or policies returned. Evidence table has JSONB snapshot/version/document_hash/hash_algorithm and submissionID fields. These are string payload sizes, not physical storage or historical billed egress attribution.

Source uses app-icon.png?inline as BRANDING.defaultLogo and supplies profile.logoDataUrl || BRANDING.defaultLogo for order creation/revision. This makes repeated default artwork plausible; no claim that all legacy logos match the current asset or that contractor logos caused historical spikes. User's directive to preserve contractor-logo behavior stays binding.

Prepared focused read-only Logo-And-Protection inventory: aggregate top15 repeated logo hashes/sizes with signed counts and comparison against current default PNG data URL; actual trigger attachments/enabled flags and table RLS policies. These were not returned in the earlier function-only export and are necessary before a migration plan affecting signed media. No raw logos, tokens, or customer records. Await user results; no app/database mutation.


## September 19 — logo/protection inventory received and original icon matched

Parsed/preserved media-protection-inventory-20260919.json. Four nonempty logo values. Largest:45 copies×2,513,010bytes=113,085,450bytes,34signed. Exact SHA-256 comparison against original supplied app-icon.png converted to PNG data URL matches e255710916eb04dabdbd6fd7056da02803a9d52766ba0bc54d0e7bebd258cee6. Thus the largest repeated image is the earlier SignForth app icon, not an unidentified contractor logo. Current bundled default255,294bytes matches four copies(two signed). Other two logo identities remain unknown.

Enabled signed-order and evidence immutability triggers confirmed attached in inventory; supplied signing logic hashes original data URL strings. Do not rewrite/recompress signed originals. Recorded a staged sidecar-storage/read-path design in SignForth-Gate4-Private-Media-Plan.md, preserving exact sources/hash verification, contractor-logo behavior and rollback. No app/SQL migration/deployment occurred in this review. Historical egress endpoint cause still unproven. Inventory request is satisfied; do not ask for it again.


## September 19 — current logo optimization verified; preserve completed work

User clarified that default-icon reduction and automatic contractor-logo resizing were already completed in the previous workspace. Verified current source: app-icon.png is512×512,191,452file bytes (~191KB),255,294PNG data-URL bytes; original reference1254×1254,1,884,741file bytes,2,513,010data-URL bytes. This is about90% smaller. BRANDING.defaultLogo imports the optimized current file. Four live order records matched its data-URL hash in the supplied inventory. The45 large historical copies do not mean current uploads still use the original asset.

Verified handleLogoUpload is wired to the contractor logo file input. It preserves aspect ratio, does not upscale, starts at512px maximum dimension, outputs PNG, checks the data URL <=1,400,000bytes, and reduces maximum dimension by25% on each retry while the threshold is at least128 (actual candidate bounds512,384,288,216,162). Rejects if none fits; saves only the processed image to profile. This is an existing client-side processing rule, not proof of server-enforced upload limits. No new upload/cross-device test run here. Existing branding.test.ts rerun:1test passed, checking payload limit,512px image and PDF embedding.

Credit both optimizations as complete. Do not rebuild/replace them or frame historical duplication as an unresolved current logo-size bug. Future private-storage work concerns storage/access and avoiding unnecessary repeated transfers while preserving existing resizing, appearance, contractor-logo behavior and signed originals. No app changes made.


## September 20 — private-media stage 1 implemented and locally validated

User authorized the next Gate 4 storage step and requested detailed, clear step-by-step deployment instructions. Completed an additive private-copy/read stage for signed, unarchived orders. Original order/evidence rows and exact source image strings remain unchanged; existing signing, logo resizing, icon, contractor branding, approved wordmark separation, email verification, iPhone layout and dashboard behavior are preserved.

New private bucket signforth-order-media-v1, owner-scoped content-addressed text copies, service-only manifest/read/preparation routines; admin-only prepare-order-media verifies uploaded/existing bytes before publishing references and completes at most five orders per call. Owner-verified contractor-order-media serves PDF reads; client-authorization gains order-media without removing old order support. Frontend verifies byte length/SHA-256, handles temporary URL expiry, and uses only bounded two-minute in-memory reuse. New/unprepared orders keep their original inline path. No original-media deletion, new-upload migration, or automatic preparation schedule is included.

Validation: 51 tests in 15 files pass; app TypeScript/full-config production build pass; separate Edge TypeScript checks pass for source/shared and Dashboard files; lint has only the existing no-thenable warning. Build has a >500 kB bundle warning. Deno/hosted execution unavailable; PGlite is single-connection; simultaneous workers, live Storage/CORS, installed-iPhone and hosted cross-account checks remain deployment requirements. Actual source comparison against Downloads/SINGFORTH GATE 4/SignForth-Gate4-client-rate-limits.zip preserves all 64 original files; only seven original files changed, with targeted new helpers/migration/functions/tests/docs added.

Deliverable: SignForth-Gate4-Private-Media-Stage1.zip, containing one complete signforth-app-secure-foundation-review source folder with updated START-HERE.md and docs/PRIVATE-MEDIA-DEPLOYMENT.md. Separate deployment and release-note copies are in outputs. The numbered guide deploys only the new SQL, then three Dashboard functions, checks denial/auth, runs verified batches, compares original/evidence fingerprints, then uploads source contents to the existing GitHub repository and checks Vercel/app behavior. It includes exact files, expected results, failure handling and rollback without reopening public RPCs. Daily rate-limit cleanup stays unchanged.

Status: PREPARED LOCALLY, NOT DEPLOYED. Do not mark this stage or Gate 4 live-complete until the user reports successful installation, zero remaining eligible copies, matching fingerprints and hosted app tests. No production API/database changes were made by the assistant. Next checkpoint is the user's deployment results. Future-upload storage, pagination, retention/export/deletion, backups/monitoring and other remaining roadmap items stay open. This stage adds Storage/copy traffic and cannot erase historical egress usage or reclaim preserved original database space.

## September 21 — preparation authentication diagnosis pending

User reports client gateway test returned 200 with actual order details. prepare-order-media repeatedly returns Administrator authorization required after service-role/header instructions. No successful copy batch has been reported; keep frontend upload pending. Existing strict comparison is incoming Authorization exactly equal to Bearer plus runtime SUPABASE_SERVICE_ROLE_KEY. Do not remove/bypass that check or assume user pasted incorrectly.

Reviewed current upstream tester code: user custom headers override defaults; this does not prove the hosted tester version or actual arriving headers. Prepared separate temporary, read-only diagnose-media-auth.ts in outputs/SignForth-Media-Auth-Diagnostic. It reports credential presence/format/exact-match booleans and explicitly unverified allowlisted role/project-match hints. No secret values, database/Storage calls or writes. Nine local diagnostic cases pass. User must deploy this separate temporary function with JWT verification off and repeat the header request to collect safe JSON. Original functions/package unchanged. Delete temporary diagnostic after resolution. Do not claim a cause or live fix until diagnostic result arrives.


## September 21 — diagnostic received; preparation-secret patch ready

Result: runtime key present, Authorization present, Bearer format valid, no comma, JWT claims service_role/matching project (unverified), but neither Authorization nor apikey equals runtime key. Confirms strict-comparison failure, not token validity or reason for difference. Do not assume rotation/user error or authorize decoded claims.

Prepared dedicated-secret check for prepare-order-media: 64 lowercase hex characters in SIGNFORTH_MEDIA_PREPARATION_SECRET and exact x-signforth-media-secret header; no Bearer prefix, no JWT fallback. Missing/malformed configuration 503, wrong/missing caller secret 403 before DB access. Built-in service key retained internally. Copy logic/other functions/frontend/SQL unchanged. 55 tests pass, Edge source/standalone typechecks pass, lint only old warning.

User must replace only prepare-order-media, set a locally generated secret in Edge Function Secrets and retry. PREPARATION-AUTH-FIX.md explains Mac command to generate/copy without displaying. No real secret generated by assistant or included in artifacts. Complete refreshed source: SignForth-Gate4-Private-Media-Stage1-Auth-Fix.zip. Standalone replacement/instructions: outputs/SignForth-Media-Auth-Diagnostic. Source START-HERE/full guide updated. Still awaiting live success, original fingerprint comparison and frontend deployment; Gate 4 open. Delete temporary diagnose-media-auth after resolution, not production prepare-order-media.
