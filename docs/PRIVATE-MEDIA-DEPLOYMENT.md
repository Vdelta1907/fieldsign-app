# SignForth Gate 4 — private-media stage 1 deployment

Updated September 21, 2026 with the preparation authorization correction. If already at the preparation step, follow `PREPARATION-AUTH-FIX.md`; do not repeat completed database steps. These are instructions for the existing SignForth project, where the previous Gate 4 rate limits and daily cleanup are already installed. Nothing in this package has been deployed to your live account by the assistant.

**Order: Supabase database → Supabase functions → private-copy checks → GitHub/Vercel → app tests.** GitHub does not automatically apply this SQL or deploy these Supabase functions unless you separately built such automation. Do not assume that uploading the app handles the backend.

This first stage gives existing signed orders verified, private copies of their images. It preserves the exact original image strings, signed records, evidence hashes and current appearance. New or unprepared orders still work through the existing inline-image fallback. We will address future uploads in a later stage.

## 1. Open the correct folder and save your rollback point

1. Download `SignForth-Gate4-Private-Media-Stage1-Auth-Fix.zip` and double-click it in Finder.
2. Open the extracted `signforth-app-secure-foundation-review` folder. You should see `package.json`, `src`, `supabase`, `docs` and `START-HERE.md`.
3. Keep this folder open. All paths below start inside it. For example, `supabase/dashboard-private-media/00-original-fingerprints.sql` means open `supabase`, then `dashboard-private-media`, then that file.
4. Use a text/code editor to read `.sql`, `.ts` and `.md` files. Select all and copy the **file contents**, not its filename. Do not use Word to edit code or include Markdown fences when pasting.
5. In GitHub, open the existing SignForth repository and note the current working branch and latest working commit. Keep the previous working source ZIP too. Do not create a new repository or change the branch connected to Vercel as part of this release.
6. In Vercel, open SignForth → Deployments and record the currently working deployment so it can be restored if necessary.
7. In Supabase, select the same SignForth project used by that Vercel app. Check the project name and project URL; do not choose a different project based only on a similar name.
8. Open **Edge Functions → client-authorization**. Use **Download** to save its currently deployed source. If Download is unavailable, copy its complete current code into a local text file. Keep this outside the upload folder. Dashboard edits replace the previous version, so this is the backend rollback copy.
9. Prefer rehearsing these steps in an existing staging project with the current schema. If using the live prototype, choose a quiet interval and avoid creating/signing orders during steps 2–7. Confirm your existing database backup/recovery method before proceeding; the fingerprint below is an integrity check, not a backup. This migration adds copies and does not rewrite originals.

**No app-logo replacement or new cleanup schedule is required. Leave the existing daily client-limit cleanup unchanged.**

## 2. Record the original signed-record fingerprints

1. In Finder, open `supabase/dashboard-private-media/00-original-fingerprints.sql`.
2. Copy all of its text.
3. In Supabase, select **SQL Editor → New query**.
4. Name the query `SignForth media - original record check` if the editor allows naming it.
5. Paste the SQL and click **Run** using the normal project administrator SQL-editor role.
6. Save the result, which contains `signed_count`, `signed_originals_digest`, `evidence_count` and `evidence_digest`. A screenshot or copied result is sufficient. It contains hashes and counts, not customer records.
7. Keep this query saved: you will run the identical query after copying.

If it errors because a referenced table or column is missing, stop and send the error text. Do not run old migrations to try to repair the schema.

## 3. Install the new private-storage database support

1. Open `supabase/migrations/202609190001_private_signed_media.sql`.
2. Copy the entire file.
3. In **SQL Editor → New query**, paste it and click **Run**.
4. Expect a success result, often “Success. No rows returned.” Run this migration **once**. It is transactional; an error rolls it back. If your browser loses the result, use the check in the next step before retrying.
5. Open **Storage** in Supabase. Confirm a bucket named `signforth-order-media-v1` exists and is **Private**. It is initially empty. Do not make it public or add upload/read policies for ordinary users.
6. Open `supabase/dashboard-private-media/01-check-installation.sql`, copy it into a new SQL query and run it.
7. Every value in `installation_checks` must be **true**. This checks the private bucket, blocking policy, protection triggers, existing limiter and service-only media routines.
8. If a value is false or the query errors, stop here and provide the result. The existing frontend still uses its old read path.

Only the `202609190001_private_signed_media.sql` file is a new migration for this release. Do not run every file in `migrations`, any file under `supabase/reference`, or a blanket database push.

## 4. Deploy the three functions using the Dashboard

Use the files in **`supabase/dashboard-private-media`** for browser copy/paste. These include their shared helpers in one file. The similarly named `index.ts` files under `supabase/functions` import separate helpers and are intended for a source/CLI deployment.

The preparer now requires one dedicated random secret, `SIGNFORTH_MEDIA_PREPARATION_SECRET`; configure it using `PREPARATION-AUTH-FIX.md` section 2 after deploying the function. Keep existing `APP_URL` and the built-in Supabase URL/service-role environment variables. `APP_URL` must match the app's existing allowed production origin. Do not put the service-role key in GitHub, the frontend, Vercel `VITE_` settings, or a message to the assistant.

### 4A. Create `contractor-order-media`

1. Go to **Edge Functions**.
2. Choose **Deploy a new function → Via Editor**. A blank or Hello World template is fine.
3. Set the function name to exactly `contractor-order-media`.
4. Open `supabase/dashboard-private-media/contractor-order-media.ts` locally and copy everything.
5. Replace all the template text in the Dashboard's `index.ts` with the copied text.
6. Deploy the function and wait for the success message.
7. Open its settings/details and turn **Verify JWT with legacy secret** (sometimes labeled JWT verification or Enforce JWT verification) **OFF**. Save/apply the setting.
8. This function performs its own user verification using Supabase Auth. Turning off the platform's legacy JWT precheck does not remove that verification.

### 4B. Create `prepare-order-media`

1. Return to **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `prepare-order-media`.
3. Replace the template with the entire contents of `supabase/dashboard-private-media/prepare-order-media.ts`.
4. Deploy and wait for success.
5. Set **Verify JWT with legacy secret** **OFF**, then save.
6. This is an administrative copy tool. Its code requires the dedicated 64-character random preparation secret in `x-signforth-media-secret`. Configure that secret using `PREPARATION-AUTH-FIX.md` section 2 before step 5A. The built-in service key remains server-side for database/Storage access.

### 4C. Update existing `client-authorization`

1. Return to **Edge Functions** and open the existing **client-authorization** function. Do not create a second differently named function.
2. Open its code editor.
3. Replace the complete `index.ts` contents with `supabase/dashboard-private-media/client-authorization.ts`.
4. Click **Deploy updates** and wait for success.
5. Confirm its existing JWT verification setting remains **OFF**.
6. Leave **submit-signature**, Stripe functions and the existing cleanup job unchanged.

The updated client function accepts both the old `order` request and the new `order-media` request, so the old frontend can keep working while you finish these steps.

## 5. Check backend access before copying

### 5A. Ordinary callers cannot run the admin copy tool

1. Open **Edge Functions → prepare-order-media → Test**.
2. Select **POST**.
3. Set the JSON request body to `{}`.
4. Remove the `x-signforth-media-secret` header for this denial test. Ordinary anon authorization may remain. Set `Content-Type` to `application/json` if needed.
5. Click **Send Request**.
6. Expected: **403** with `Administrator authorization required.` No copies should be made.

### 5B. The contractor route requires an actual signed-in user

1. Open **contractor-order-media → Test**.
2. Use POST with `{}` and no Authorization header (or anon authorization).
3. Send the request.
4. Expected: **401** and `Sign in to view this order.` A service-role token is not a substitute for a contractor user session on this endpoint.

### 5C. The public gateway still works

1. Open a test order's existing client link in the app. Do not use a customer's active order for destructive testing.
2. Confirm it still shows its normal details.
3. For a direct new-route check, open **client-authorization → Test**, method POST, authorization **anon**.
4. Use this body, replacing the placeholder with the UUID from your test order's existing signing link:

```json
{"action":"order-media","signingToken":"YOUR-TEST-LINK-TOKEN"}
```

5. Expected for a valid available link: **200** with a `data` array containing the order. Before copying, its images are still inline and `_media` is empty.
6. If the order is unavailable, a 200 response with `data: []` is expected; use an available test link to check the successful path. A malformed token produces 400.
7. Do not share live signing tokens or returned customer data in screenshots. If troubleshooting is needed, send only the status and error message.

## 6. Make verified private copies in small batches

The September 21 correction replaces manual service-role JWT entry for this tool.

1. If not already done, follow section 2 of `PREPARATION-AUTH-FIX.md` to generate and save `SIGNFORTH_MEDIA_PREPARATION_SECRET` in Supabase Edge Function Secrets. Use the supplied Mac command; do not invent a short password or reuse an API key.
2. Open **prepare-order-media → Test**, choose **POST**, and set the body to `{}`.
3. Remove the manually added Authorization header. Add **Header name** `x-signforth-media-secret` and **Header value** equal to the exact secret you saved. No `Bearer` prefix. The linked correction guide explains clipboard handling in detail.
4. Click **Send Request once**, then wait for the result.
5. A successful response contains `processed`, `remaining`, `prepared`, `references` and `unique_objects`. `processed` is at most five. Repeat one request at a time until `remaining` is zero.
6. If a request times out, check `02-check-progress.sql` before retrying. Verified copies are reused safely and the worker resumes without overwriting originals.
7. A 403 means the custom secret header did not match. A 503 naming preparation-secret configuration means the saved variable is missing or malformed. Other 503 errors can describe an upload/database/verification failure; stop and share only the error/counts. Never bypass verification, delete originals or mark rows prepared manually.
8. Keep credentials out of screenshots. Do not regenerate the secret between saving it and making the request.

Only signed, unarchived orders are eligible. The earlier 51 signed orders may not equal today's eligible count. Storage `.txt` files hold exact original image data URL strings for hash verification; do not rename or edit them.

This copy uses transfer and adds private storage. It does not refund historical egress or reclaim original database space. App downloads still use egress.

## 7. Confirm completion and unchanged originals

1. Open `supabase/dashboard-private-media/02-check-progress.sql`.
2. Run it in a new Supabase SQL Editor query.
3. Confirm `remaining: 0`. `unique_objects` may be less than `references` because repeated images are shared within one contractor's account.
4. Run your saved **original record check** from step 2 again.
5. Compare the two counts and two digests with your saved baseline. They should match exactly if no orders/evidence were added during the interval. A changed count means the comparison included other activity; investigate it instead of calling the migration verified automatically. If counts match but a digest differs, stop before frontend deployment.
6. Repeat the `order-media` test for a prepared signed test order. Its response now includes `_media` entries with `field`, `sha256`, `byteLength` and a temporary `url`; prepared image fields are `null` in this metadata response. This is correct: the new frontend will retrieve and verify their original contents.
7. Leave those temporary URLs private. They authorize access for 60 seconds. Expiration does not revoke a copy already downloaded.
8. Open the old frontend once more and confirm an existing signed PDF still opens. Its previous read path remains available for rollback.

## 8. Upload the app source to GitHub

**Upload the CONTENTS of `signforth-app-secure-foundation-review` into the existing repository root.** Do not upload the outer ZIP, the enclosing folder itself as a new nested directory, your Downloads folder, or an `outputs` folder.

1. Open the existing SignForth repository in GitHub.
2. Select the same working branch you recorded in step 1. If your normal process uses a preview branch and pull request, use that process and verify the preview before merging to the production branch.
3. Navigate to the repository root, where its existing `package.json` and `src` folder are visible.
4. Click **Add file → Upload files**.
5. In Finder, open the extracted source folder, select its contents, and drag them into the upload area. Keep the folder hierarchy: `src/App.tsx` must remain under `src`, not beside `package.json`.
6. Finder hides files beginning with a dot. Press **Command–Shift–.** to show them if needed. The package's `.env.example` is a template; there is no real `.env` or credential file to upload. Preserve the existing `.gitignore` and repository-specific files.
7. Wait for uploads to finish. In the preview, confirm files are being updated at their existing paths. If the preview starts with `signforth-app-secure-foundation-review/src/...`, cancel and upload the inner contents instead.
8. Leave unrelated repository files intact. Do not delete the entire repository first. If GitHub warns about upload limits, use your existing GitHub Desktop workflow to copy the same source contents into its repository folder, review changes, commit and push.
9. Use this commit message:

```text
Add verified private media reads for signed orders
```

10. Commit through your normal branch/PR process. If that branch triggers Vercel automatically, deployment should start.
11. In **Vercel → SignForth → Deployments**, wait for **Ready** on the new commit. If it fails, read the build log and do not change unrelated settings.
12. Preserve the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values. Do not copy the harmless local build-test placeholder values from release notes into Vercel.
13. Confirm the Vercel root directory still points to the location containing `package.json`. With an existing root-based repository it stays at the repository root.
14. Open the new deployment, reload your browser, and close/reopen the installed iPhone app before testing.

Keeping SQL and function source in GitHub records the release, but does not replace the manual Supabase deployment you completed first.

## 9. Test the deployed app

Use your existing test accounts and test orders. Check the following before marking this stage deployed:

1. **Existing signed order:** sign in as its contractor, expand Signed and open **View Signed Authorization PDF**. Confirm the original logo, signature, attached photos, amount, dates and text appear. Include an older order with the larger historical logo if you have a test record of that type. Do not replace that old artwork.
2. **Client receipt:** open that signed test order's client link in a private browser window without a contractor login. Confirm the receipt and PDF still work. The link's existing allowed/closed behavior should remain the same.
3. **Unsigned order:** create a test draft with your normal contractor logo and two test photos. Send its link, review, sign and open the resulting PDF. Newly signed orders work even before their next private-copy batch because their original inline fields remain available.
4. **Account isolation:** sign out and sign in to your other test contractor account. Confirm the first account's orders are absent. For a stronger endpoint check, a developer should attempt its order ID through `contractor-order-media` using the second account's session; expected 404. Do not paste session tokens into chat. Local automated tests cover the owner check, but hosted verification is still required.
5. **Closed links:** open existing expired, cancelled, superseded and archived test links. Confirm they retain their prior closed/unavailable behavior. Do not cancel/archive customer records solely for a test.
6. **Retry:** open a signed PDF twice. It should remain identical. Wait over two minutes and open it again; the app should obtain fresh authorization and download again when needed.
7. **Visual regression:** on the installed iPhone app, check header spacing, the tiny spring-back motion with all categories closed, and scrolling inside an expanded category.
8. **Existing flows:** verify normal login/email-verification behavior, contractor-logo selection and the usual Stripe continuation using your existing test-mode procedure. Do not make a real payment solely to test this release.
9. **Service health:** check Supabase Edge Function logs for repeated 401/403/503 errors on the three affected functions. Do not log or share complete media responses.

Optional network verification in a desktop browser:

1. Open browser Developer Tools → Network; clear the list.
2. Open a prepared signed order/PDF.
3. The `contractor-order-media` or `client-authorization` response should contain small media references, not the large prepared image strings. Separate temporary Storage downloads supply those images.
4. Open the same PDF again within two minutes. A fresh gateway request still checks authorization, but the verified image bytes can be reused from memory without another download.
5. Compare total transferred bytes and request counts, including Storage traffic. Do not compare only the database response and declare all egress eliminated. The dashboard list was already excluding image fields; this change targets detail/receipt/PDF reads.

## 10. If something fails

- **Migration error / false installation check:** stop before changing the frontend and provide the exact error or failing check.
- **“Invalid JWT” before function code runs:** confirm the named function's legacy JWT verification toggle is off; keep its code's own checks intact.
- **Admin copy returns 403:** confirm `x-signforth-media-secret` equals the saved `SIGNFORTH_MEDIA_PREPARATION_SECRET`, without a Bearer prefix. Follow `PREPARATION-AUTH-FIX.md`; do not rotate project API keys.
- **App request blocked by CORS:** check existing `APP_URL` against the app origin. Do not use a wildcard to work around it.
- **429:** wait for the displayed retry interval; do not raise project limits just to force a batch or UI test through.
- **Media verification error:** stop and keep the originals/copies intact for diagnosis. The app deliberately refuses a mismatched image instead of silently using a different logo.
- **402 / quota restriction:** this is a separate Supabase account-usage problem. This release does not erase the previously accrued egress shown in your screenshots.

### Rollback if the new frontend causes problems

1. In Vercel, restore the working deployment you recorded before the update, using its rollback/promote action, or revert the GitHub release commit through your normal workflow and wait for the old app to redeploy.
2. Reload the app and check an existing signed PDF. The new `client-authorization` still supports old `order` requests, so it can remain deployed while investigating.
3. If the updated `client-authorization` itself is faulty, restore the complete saved function from step 1 through the Dashboard and deploy it; keep its previous JWT configuration. Restore the old frontend first because it does not request `order-media`.
4. Leave private tables, the private bucket and copied objects in place. No reverse database migration is needed to return to the old read path.
5. **Do not re-grant public access to the old RPCs.** The older rate-limit release's rollback instructions are not the rollback procedure for this stage.
6. Do not disable signed-order or evidence triggers, delete original image fields, or mark the bucket public.

## 11. Report the checkpoint

When finished, report:

- Installation checks: all true, or the failing check.
- Copy progress: remaining, prepared, references and unique_objects.
- Original fingerprints: match or mismatch; no raw customer records needed.
- Vercel deployment: Ready or the build error.
- App checks: passed, or the exact failing step and visible message.

Then we can mark **private-media stage 1** deployed and move to the next Gate 4 item. Full Gate 4 remains open. Future-upload storage, pagination, retention/export/deletion and operational readiness still need their own work. There is no new cron job to configure for this stage; recently signed orders use the fallback until this preparation tool is deliberately run again.

## Reference documentation

Dashboard editor, deployment and tester behavior: [Supabase Dashboard function guide](https://supabase.com/docs/guides/functions/quickstart-dashboard).

Private bucket access and temporary signed links: [Supabase Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).

Function authentication: [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth).
