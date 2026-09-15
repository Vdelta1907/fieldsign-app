# SignForth account isolation and Settings update

This package is based on the uploaded secure-foundation ZIP. It has not been deployed to your GitHub, Vercel, Supabase, or Stripe accounts. Keep the original ZIP as a checkpoint. Do not delete main during this update.

## What changed

- A SessionBoundary owns authentication. Each signed-in account gets a fresh workspace. Switching accounts or signing out destroys the previous profile, orders, editor, menus, and Stripe launch state.
- Workspace requests can only use the current workspace owner's token. Responses arriving after the workspace ends are rejected, including A → B → A switches.
- Profiles must load successfully before contractor screens can be used. Missing rows get clean defaults; failed loads show Retry instead of falling back to old data. No browser profile cache is read.
- Stripe status refreshes on initial profile load and when returning to the app. Status requests never create accounts. Server ownership metadata is checked before returning status or an onboarding link. A mismatch fails closed and requires investigation; this code does not silently reassign Stripe accounts.
- Connected full-dashboard accounts receive a Stripe login URL. The temporary opening page remains for mobile popup compatibility. Opening has a timeout and closes if the SignForth workspace ends before navigation.
- The user menu now has Account settings, Branding & Stripe Setup, and Sign out.
- Account settings requires the current password for email/password changes and deletion requests. The password check happens in a server function against the authenticated user. Email changes require the Supabase confirmation settings below. Password changes attempt global sign-out and clear the local session.
- Email verification keeps its auth listener alive, so Go to Login followed by sign-in works without refreshing. Verification errors are read from query or hash without double decoding.
- New profiles start with default terms ON and a blank custom draft. Turning defaults off shows that draft; switching back and forth preserves it. Previously saved custom text is not deleted, even if it equals the default wording.

## Important deletion boundary

The red deletion UI is a **verified deletion request**, not an automated account erasure. It requires the current password and typing DELETE, and records one request per user in account_deletion_requests. The screen explicitly says the account remains active pending review.

Automatic deletion, deactivation, and record anonymization are not enabled. The complete live foreign-key/retention schema and final deletion policy were not present in the upload. Deleting an auth user can cascade into related data. An automated purge must wait until the retention rules and live relationships are reviewed. Requests are not emailed to an administrator; review the table in Supabase. Establish a review/response process before offering this publicly.

## 1. Update the secure-foundation code

In GitHub, select secure-foundation. In your local checkout, verify that same branch is selected before copying files.

Replace these complete files from this ZIP:

- src/App.tsx
- src/main.tsx
- src/index.css
- package.json
- package-lock.json
- supabase/config.toml
- supabase/functions/stripe-connect-onboard/index.ts

Add these new files/folders:

- src/components/SessionBoundary.tsx
- src/components/AccountSettings.tsx
- src/lib/workspaceClient.ts
- supabase/functions/account-security/index.ts
- supabase/migrations/202609160001_account_profile_isolation.sql
- vitest.config.ts
- tests/ (all five files)
- START-HERE.md

Keep your local .env files and Vercel environment variables. No real credentials or node_modules are included. Other supplied source files are retained from your original ZIP; no unrelated checkout/signing functions need redeploying for this update.

Suggested commit: `Isolate account workspaces and separate account settings from branding and Stripe`

## 2. Apply only the new SQL migration

In the existing SignForth Supabase project's SQL Editor, open a new query. Copy the entire contents of:

supabase/migrations/202609160001_account_profile_isolation.sql

Paste from the first comment through the final `commit;`, then Run once. It restricts profile writes, adds an owner boundary, enforces unique Stripe ownership, and creates the private deletion-request table.

If it fails, save the error and stop this deployment step; do not remove a constraint or policy to force it through. Existing duplicate Stripe IDs will intentionally prevent the migration from completing. Resolve their provenance first.

**Do not reset the database, replay the 20260830 migrations, or run a blind `supabase db push`.** Only three early migrations were included in the upload. The later Gate 2–4 functions, evidence tables, and grant changes performed in SQL Editor are not fully represented here. Reconstructing that migration history is separate work. This new migration preserves order/evidence tables and their policies.

## 3. Deploy the two relevant Edge Functions

In Supabase Edge Functions, replace stripe-connect-onboard with the complete matching file in this ZIP and deploy it. Add and deploy account-security with its complete file. Both import the existing _shared/cors.ts; retain that shared file.

If using the Supabase CLI against the already-linked correct project:

```bash
supabase functions deploy stripe-connect-onboard --no-verify-jwt
supabase functions deploy account-security --no-verify-jwt
```

Both functions verify the bearer token using Supabase Auth inside the function. account-security additionally checks the current password. Existing platform secrets stay in Supabase; never paste them into frontend code.

APP_URL must be `https://fieldsign-app.vercel.app`. STRIPE_SECRET_KEY must remain the correct platform/mode key. Existing SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are used server-side. Do not redeploy create-checkout, cancel-order, or stripe-webhook solely for this change.

## 4. Confirm authentication configuration

Site URL: `https://fieldsign-app.vercel.app`

Keep these exact allowed redirects:

- `https://fieldsign-app.vercel.app/?email-verified=1`
- `https://fieldsign-app.vercel.app/?reset-password=1`

Email confirmation and secure email change (confirmation of both current and new addresses) must be enabled. Enable secure password change/reauthentication as well. The server verifies the current password and obtains a fresh session before requesting a change; provider configuration governs confirmation links. The interface alone cannot enforce those project settings.

References: [Supabase updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## 5. Build and deploy the frontend

From the project folder, with your existing local VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY configured:

```bash
npm ci
npm test
npm run build
```

Commit and push secure-foundation using your normal workflow after the SQL and functions are ready. Verify the deployment serving `https://fieldsign-app.vercel.app` uses this commit. Downloading a ZIP or saving locally does not itself update Vercel.

## Focused acceptance checks

1. Same browser: sign into A, inspect its company and Stripe status; sign out, then sign into B. No A data should appear, even while loading. Try A → B → A. New B should have empty business fields, its own email, default terms ON, and Connect with Stripe unless its own account has actually been linked.
2. Slow network: switch accounts while a profile/Stripe request is pending. The late result must not populate the next account. A failed profile load must show Retry, not editable fallback data.
3. Stripe: open setup for a new account and manage a connected one. Return to SignForth and verify the status refreshes. Test Safari and the installed Android app because desktop tests do not establish popup behavior on those devices. Stripe itself can retain its own login independently; full-dashboard management uses Stripe login and may require selecting the correct Stripe account.
4. Terms: switch OFF, enter custom wording, toggle ON/OFF, save, refresh. The draft should survive. An existing record already saved with default wording as custom text is preserved intentionally.
5. Account settings: incorrect current password must reject changes. Confirm an email change using the requested inbox links; the new login address should work after confirmation. Change password and sign in again with the new password. This targeted check also verifies the new password flow's session cleanup.
6. Deletion request: Cancel must do nothing. Wrong password must reject. Correct password + DELETE records a pending request and displays accurate pending-review wording; it must not erase signed records or claim the account was deleted.
7. Verification follow-up: Go to Login after email verification, then sign in without refreshing the page. The dashboard should now open only after that explicit login.

Do not repeat the entire completed order/signature/payment gate suite for this Settings change. Existing successful cross-device logout testing remains recorded; only the new password-change cleanup path needs a targeted check.

## Validation and limits

- 11 automated tests pass: account boundaries, late requests, real Settings profile/terms behavior, PostgreSQL RLS/column grants, Stripe ownership rejection and connected URL response, and server identity checks.
- TypeScript and Vite production build pass with locked dependencies.
- Both edited/new Edge Functions passed Deno type checking against their imported SDKs.
- Account Settings and Branding & Stripe Setup were rendered in headless Chromium at a 390px mobile viewport; neither had horizontal overflow. Password-eye controls were visually checked. This is not a physical Safari or Android-installed-app test.
- Tests use mocked authentication/Stripe responses and an isolated PostgreSQL-compatible test engine. No real users, charges, emails, deletion requests, or production data were changed.
- The uploaded frontend already contained the earlier profile-cache removal. Confirmed gaps included account-wide state surviving sign-out, a sticky Stripe launch label, no Stripe status refresh after onboarding, and a connected-function response lacking the URL expected by the frontend. Without live database/deployment access, these findings do not prove which combination caused the observed production account crossover.
- Existing database rows or Stripe ownership metadata are not repaired automatically. A mismatch must be investigated instead of assigning the account to whichever user signs in next.
- Gate 4 remains open pending the focused deployed checks, final deletion policy/automation, and any remaining gate requirements. This package is not a production security certification.
