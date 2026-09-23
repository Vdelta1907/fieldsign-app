# SignForth — targeted new-upload storage deployment

Prepared September 23, 2026. This release is tested locally and NOT yet deployed to your accounts. It builds on your accepted pagination release. Follow this guide in order; no whole-app replacement is needed.

## What changes

New saves store processed logos/photos in private Storage and retain compact, owner-checked references in the existing database fields. Signatures are uploaded by the signing server. Readers retrieve and verify the exact original image strings before display/PDF use. New reference-based authorizations use evidence snapshot version 3, with hashes of the actual image strings. Existing signed orders/evidence are not rewritten; legacy inline orders remain supported.

Appearance and workflow remain the same: contractor/default logos, automatic logo resizing, two photos, revisions, signing, payments, email verification, iPhone behavior and 10-order pagination are preserved. This does not bulk-migrate historical records, delete originals, add thumbnail displays or complete retention/export/deletion, monitoring, backups or all of Gate 4.

**Important deployment order: database with writes OFF → three Edge Functions → targeted GitHub files/frontend → checks → enable new uploads.**

## 1. Open the package and record the current version

1. Extract **SignForth-New-Uploads-Targeted.zip**.
2. Open **SignForth-New-Uploads-Targeted**. It contains this guide (**README-FIRST.md**), **FILE-MANIFEST.md**, **SHA256SUMS.txt**, and **github-files**.
3. All repository changes are under `github-files`. Other files at the top are instructions/checksums, not app files.
4. In your existing GitHub repository, open the latest working commit and save its link in your notes. This is your pagination baseline.
5. Choose a quiet period for deployment. Until Step 6 finishes, do not create/sign/edit orders during the fingerprint comparison.

## 2. Save the original-record fingerprint

1. In the extracted package, open `github-files/supabase/dashboard-future-media/00-original-fingerprints.sql` in your code/plain-text editor.
2. Copy the complete contents.
3. Open your existing SignForth Supabase project, then **SQL Editor → New query**.
4. Paste the SQL and click **Run**.
5. Save the returned **original_record_check** result in your notes. It contains counts and hashes, not customer documents. You will compare it in Step 6.

This is a read-only integrity check, not another preparation batch.

## 3. Install the database support, with uploads disabled

1. Open `github-files/supabase/migrations/202609230001_future_private_media.sql`.
2. Copy the entire file into another new Supabase SQL Editor query.
3. Click **Run** once. Expect success, usually “Success. No rows returned.”
4. If an error appears, stop and share its exact text. The migration checks that the signing routine still matches the reviewed definition and runs transactionally. Do not remove that check to force it through.
5. Open `github-files/supabase/dashboard-future-media/01-check-installation.sql`, copy it into a new query, and run it.
6. Every value in **installation_checks** must be **true**, including **writes_disabled**. If any is false, stop before deploying the app and send the result.

Run only this new migration. Do not rerun old migrations, the private-media preparation batch, or the earlier rate-limit setup. New registry records will not be created until you enable uploads later. If installation already succeeded, do not rerun the migration; use the read-only check.

## 4. Deploy exactly three Edge Functions

Use the self-contained files in **dashboard-future-media** for Supabase's online editor. They already include their shared helpers. Do not paste a modular `functions/.../index.ts` file on its own into the Dashboard.

| Supabase function | Action | File to copy into its index.ts |
| --- | --- | --- |
| `contractor-media` | Create new function | `github-files/supabase/dashboard-future-media/contractor-media.ts` |
| `submit-signature` | Update existing function | `github-files/supabase/dashboard-future-media/submit-signature.ts` |
| `client-authorization` | Update existing function | `github-files/supabase/dashboard-future-media/client-authorization.ts` |

For **contractor-media**:

1. Open **Edge Functions** in your SignForth project.
2. Choose **Deploy a new function → Via Editor** (or the equivalent create-in-editor option shown).
3. Name it exactly **contractor-media**.
4. Select all starter content in `index.ts` and replace it with the entire matching standalone file above.
5. Deploy it.
6. In that function's **Details / Function configuration**, turn **Verify JWT with legacy secret** off if it is on, and save. This function verifies the signed-in user's session itself using Supabase Auth before accepting any image request. Do not change project JWT keys or global Auth settings.

For each existing function, **submit-signature**, then **client-authorization**:

1. Open the existing function under Edge Functions.
2. Open its code editor and `index.ts`.
3. Replace its contents with the entire matching standalone file above.
4. Deploy/save the update.
5. Keep platform legacy JWT verification off for these public signing-token routes. Their existing token checks and rate limits remain inside the code.

No new secret is required. Keep `APP_URL` and existing Supabase runtime configuration. Do not add/recreate the old preparation secret or diagnostic function. Do not redeploy `prepare-order-media`, payment functions or `contractor-order-media` for this release.

Optional denial check: use the new contractor-media function's Test panel with POST and body `{}` and no signed-in user's access token. A **401** response is expected. It is not a failed upload test; actual authorized uploads are tested through the app below. Do not paste a service key or JWT signing secret to make this denial test succeed.

Supabase's official [Dashboard deployment guide](https://supabase.com/docs/guides/functions/quickstart-dashboard) documents the editor workflow; its [401 troubleshooting guidance](https://github.com/supabase/supabase/blob/master/apps/docs/content/troubleshooting/edge-function-401-error-response.mdx) identifies the per-function legacy JWT setting. These sources cover the interface; the authorization behavior above is implemented in this package.

## 5. Upload only the targeted files to GitHub

1. Open the root of your existing repository on the branch you normally deploy.
2. Choose **Add file → Upload files**.
3. In Finder, open the package's **github-files** folder.
4. Select its contents: **src**, **supabase**, **tests**, **scripts**, **docs**, and **START-HERE.md**. Drag those items into GitHub's upload area.
5. Do not drag the enclosing `github-files` folder, the enclosing ZIP folder or the ZIP itself. GitHub paths should begin with `src/`, `supabase/`, etc., not `github-files/`.
6. Check the upload list against **FILE-MANIFEST.md**. Replace only its listed existing files and add only its listed new files. Uploading these partial folders does not require deleting the existing folders or their other files.
7. Commit using:
   **Move new order media to private storage with verified references**
8. If your branch requires a pull request, use your existing review/merge workflow.
9. Open the resulting commit's changed-files view and confirm the file list matches the manifest.
10. Open your existing Vercel project and wait for this commit's deployment to show **Ready**. Keep all environment variables and build settings unchanged.

The older `dashboard-private-media` standalone files included in the patch are regenerated source copies for repository consistency/testing; they are not additional Edge deployments. The migration is version-controlled in GitHub, but uploading it does not execute it in Supabase. If you use an automated migration pipeline instead, coordinate through it so this migration executes only once.

## 6. Verify the reader deployment before enabling uploads

1. Reload the deployed website and close/reopen the installed iPhone app. Sign out and back in if the old session/view is still present. Use the updated app for the remaining tests.
2. Open an existing signed test order's contractor PDF. Check its logo, photos and signature.
3. Open an existing signed test receipt in a private browser window and check its PDF.
4. Confirm the dashboard still loads 10 orders, Load more works, the attention banner filters responses, category switching returns to the top, and declined orders appear under Pending.
5. Repeat **00-original-fingerprints.sql** before creating or signing new test orders. Compare all four values with Step 2: they should be identical. If legitimate signing occurred during deployment, the aggregate may change; do not interpret that alone as corruption. Stop and reconcile the change before proceeding.
6. Repeat **01-check-installation.sql**. All values should still be true, including writes_disabled.
7. If any reader or integrity check fails, stop here and send the result. Do not enable uploads yet.

## 7. Enable new private uploads

1. Open `github-files/supabase/dashboard-future-media/02-enable-new-uploads.sql`.
2. Copy all its contents into a new Supabase SQL query and run it.
3. Expect **new_private_uploads_enabled = true**.
4. Reload SignForth once more. There are no upload secrets or manual keys to paste: the signed-in app sends its session automatically.

This switch affects future saves/signatures. It does not rewrite old images or migrate old signed orders. Existing users should reload the updated app before editing profiles or orders. Old client signing links remain supported; this release also retains the earlier public gateway read operation.

## 8. Run the live acceptance checks

Use test orders and non-sensitive test images. Turn off payment-upfront for the signing test so no actual charge is needed. Leave the existing production payment setup unchanged.

1. **Logo/profile:** In your test account's Branding & Stripe Setup, upload a test contractor logo and save. Reopen Settings after signing out/in and confirm the same logo appears. Existing resize behavior should be unchanged. If you intentionally use the default logo, confirm it still appears when creating an order.
2. **Draft:** Create a test order with two photos and a description, then **Save Draft & Exit**. Reload, open Drafts and Continue Editing Draft. Verify both photos and entered details return.
3. **Publish/review:** Complete the details and send the order through the existing flow. Open its client link in a private window. Verify logo, both photos, terms, scope and amount.
4. **Revision:** Before signing, request changes or decline in the client view. Revise the order from the contractor dashboard, replace one test photo, publish and open the new link. Verify the new photo and scope. The old link should show the existing retired/closed behavior. The existing revision-history display should still work.
5. **Sign:** Sign the current test order. Verify the client receipt and client PDF contain the correct images and signature. Then open the contractor PDF and compare.
6. **Reload:** Close/reopen the app and reload the client receipt. Images should still load; they must not depend on the page retaining its original in-memory image data.
7. **Old record:** Reopen a pre-update signed test PDF. Its appearance should remain unchanged.
8. **Account separation:** Sign out, enter your other test account, and confirm its profile/orders show only that account's information. Switch back and verify the test order/PDF remains available. This is an account-switching check; direct hostile endpoint tests are covered locally, not independently certified on your hosted project.
9. **Failure recovery:** On a disposable draft, add a new test photo, take the device offline, and try Save Draft & Exit. It should report a failure and retain the form. Restore the connection and retry. For a failure before upload finishes, no draft should have been written. A connection lost after a save reaches the server remains an uncertain-response scenario; check the dashboard before repeating a save. This update does not redesign the older direct draft-insert retry contract.
10. **iPhone:** Check header spacing, collapsed-dashboard spring-back and scrolling only inside expanded orders, including Load more.
11. Run `github-files/supabase/dashboard-future-media/04-check-new-storage.sql` in SQL Editor. Expect enabled=true, verified_objects greater than zero, orders_with_references greater than zero, and version_3_signed_evidence greater than zero after signing. profiles_with_references is greater than zero if you saved a custom logo. Counts need not equal each other because identical images are reused within an account.
12. Send the aggregate result and your pass/fail observations. Do not send raw private image URLs, signing tokens or keys.

Uploads have bounded sizes and a per-account write rate limit. If you see a wait message during repeated tests, wait the indicated interval and retry; form details remain in place. A 10-order dashboard page does not automatically fetch all of its media.

## 9. If a problem appears after enabling

1. Run **03-disable-new-uploads.sql**. Expect **new_private_uploads_enabled = false**.
2. Keep the updated readers, frontend and database routines installed. They are needed for references already saved. Existing verified images remain readable; previously cached references can still be reused. Fresh uncached images/signatures follow the older inline path while the switch is off.
3. Share the failed step and error message. Do not delete Storage objects or registry rows, drop this migration's functions, remove evidence protection or restore the pre-update frontend after references have been created.
4. Before any new references exist, a frontend revert to your previous commit is possible with uploads disabled. After new references exist, use the write-disable switch and a targeted fix instead.

## Validation and limits

- Full final automated suite: **73 tests passed across 22 files**, including the real draft-save failure/retry test.
- App typecheck and production build passed with placeholder public build configuration. Source and standalone Edge files passed TypeScript checks with Deno declarations.
- Lint completed with the existing thenable-test warning; the existing large-bundle build warning remains.
- Tests exercised local PostgreSQL-compatible migration execution, real reviewed create/revision/signing routines, source-hash evidence, legacy immutability, owner denial, failed/corrupt uploads, idempotent signature retries, feature disable/read compatibility, browser reference resolution and real draft form recovery.
- Native Deno execution, hosted Storage/CORS, simultaneous database sessions, physical-device behavior and the live deployment still require the checks above. No production changes have been made by the assistant.
- Files are exact data-URL text objects so their original evidence hashes remain meaningful. Thumbnails, automatic orphan cleanup, retention/deletion/export and remaining operational work are separate unfinished items. Do not delete historical originals to reclaim space as part of this release.
