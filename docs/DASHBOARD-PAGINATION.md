# SignForth dashboard pagination — targeted deployment

Prepared September 22, 2026. Local implementation and tests complete; this update has NOT been deployed to your Supabase or GitHub account. Gate 4 remains in progress.

## What users will see

- Opening a category displays its newest 10 orders, or fewer if there are fewer available.
- At the bottom of the expanded list: **Showing 10 of 35 orders** and a **Load more** button. Each tap appends up to 10 older orders. After the last batch, the button disappears and the text reads **Showing all 35 orders**. These numbers are examples.
- Switching categories starts at that category's newest 10 orders and returns the list to the top. Closing and reopening a category also starts over.
- The existing blue attention banner opens a **Needs attention** list of change requests and declined orders. It uses the same 10-order batches. Clicking the banner again collapses it; selecting a category switches to that category.
- Pending includes pending, changes-requested and declined orders. Declined orders keep their Declined label and existing actions. No saved status is rewritten.
- Counts and dollar totals cover all unarchived orders belonging to the signed-in account, regardless of how many are currently loaded.
- Background updates refresh already-loaded batches without intentionally resetting the scroll position. The page lock, collapsed-dashboard spring-back and expanded-list scrolling remain in place.

## 1. Open the targeted package and record your rollback point

1. Download and unzip **SignForth-Dashboard-Pagination-Targeted.zip**.
2. Open its **SignForth-Dashboard-Pagination-Targeted** folder. You will see this guide, named **README-FIRST.md**, and a **github-files** folder.
3. Do not upload the ZIP, the enclosing folder or the `github-files` folder itself to GitHub. The files INSIDE `github-files` belong at the corresponding paths in your existing repository.
4. Open your existing SignForth repository in GitHub. Open its commit history and copy the current working commit's link into your notes. This identifies the source you can restore if necessary.
5. Use the existing repository and its currently deployed branch. This update assumes the tested private-media stage 1/Auth-Fix version is already deployed, as confirmed in our checkpoint.

## 2. Add the database function in Supabase FIRST

This step adds one dashboard read function and an index. It does not change order contents, signed evidence, existing access policies or Edge Functions.

1. Open Supabase and select your existing **SignForth_dev.** project. Confirm it is the project your app uses.
2. Open **SQL Editor**, then create a **New query**.
3. On your Mac, open this file from the extracted package in a plain-text/code editor:
   `github-files/supabase/migrations/202609220001_dashboard_pagination.sql`
4. Copy the entire file, from its first comment through `commit;`, into the new Supabase query.
5. Click **Run** once. Expect a success message, usually **Success. No rows returned**.
6. If it reports an error, stop before deploying the frontend and share the error text. Do not run older migrations as a workaround. The migration is transactional; a failure prevents a partially installed function.
7. Open another new query and run this read-only installation check:

```sql
select
  to_regprocedure('public.signforth_dashboard_page(text,timestamp with time zone,uuid)') is not null as function_installed,
  to_regclass('public.signforth_orders_dashboard_page_idx') is not null as index_installed,
  has_function_privilege('authenticated', 'public.signforth_dashboard_page(text,timestamp with time zone,uuid)', 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', 'public.signforth_dashboard_page(text,timestamp with time zone,uuid)', 'EXECUTE') as anon_can_execute;
```

8. Expected: **true, true, true, false**, in that order. If not, stop and share the results.

Run only this new migration for this update. If you already ran it successfully, do not run it a second time: it intentionally uses `create function`, so a duplicate installation reports that the function exists. Use the read-only check instead. Do not rerun media preparation, recreate the temporary diagnostic function, add secrets or change JWT settings.

## 3. Upload only these nine files to GitHub

The package contains complete replacement contents for changed files, plus the new files. You do not need to paste individual code fragments.

| Repository path | Action |
| --- | --- |
| `src/App.tsx` | Replace existing file |
| `src/hooks/useDashboardOrders.ts` | Add new file |
| `supabase/migrations/202609220001_dashboard_pagination.sql` | Add new file for version history |
| `tests/dashboard-pagination.test.tsx` | Add new file |
| `tests/dashboard-pagination-db.test.ts` | Add new file |
| `tests/dashboard-pagination-ui.test.tsx` | Add new file |
| `tests/profile-settings.test.tsx` | Replace existing test fixture |
| `docs/DASHBOARD-PAGINATION.md` | Add this deployment guide |
| `START-HERE.md` | Replace outdated starting instructions |

For GitHub's website:

1. Open the repository root on the deployed branch. You should see existing folders such as `src`, `supabase` and `tests`.
2. Click **Add file → Upload files**.
3. In Finder, open `github-files`. Select the four folders **src**, **supabase**, **tests**, **docs**, plus **START-HERE.md**, and drag those selected items onto GitHub's upload area. Select the contents, not the `github-files` enclosing folder.
4. Check the upload list carefully. It must show the nine paths above, with no `github-files/` or `SignForth-Dashboard-Pagination-Targeted/` prefix. Uploading these folder contents adds/replaces the listed files; it does not delete other files already in those folders.
5. If paths are wrong, cancel the upload and repeat from the repository root.
6. Use this commit message: **Add 10-order dashboard pagination and actionable response filters**.
7. Commit the upload to your existing deployed branch, or follow your existing pull-request workflow if the branch is protected. Do not create a new repository or delete existing app folders.
8. Open the resulting commit's changed-files view. Confirm only the nine files above changed. The application change is concentrated in `src/App.tsx` and the new dashboard hook; no CSS, logo, dependency, Edge Function or environment-variable file should change.

The SQL file in GitHub records the migration; uploading it does not replace running it in Step 2. If you have separate automated migration deployment configured, record it through that existing workflow instead of executing it twice.

## 4. Wait for the frontend deployment

1. Open your existing Vercel project and its **Deployments** page.
2. Find the deployment triggered by the new GitHub commit. If you normally deploy through a different existing host, use that deployment workflow.
3. Wait until it reports **Ready**. Keep the existing environment variables and project settings.
4. If the build fails, open its build log and share the error. Do not replace Supabase keys or change signing functions to fix a frontend build.
5. Open the deployed SignForth app, reload it, and sign in normally. On your installed iPhone app, close and reopen it after deployment.

## 5. Check the deployed behavior

Use your own test orders. No real payment or repeated media-preparation batch is required.

1. **First batch:** Open All Orders. If you have more than 10 unarchived orders, verify exactly 10 cards appear initially, newest first. Scroll inside the expanded orders area to see **Load more**.
2. **Next batches:** Tap Load more. Verify up to 10 additional cards appear below the existing cards, without jumping to the top or duplicating them. Continue until the final batch; the button should then disappear.
3. **Category reset:** After loading more and scrolling down in All Orders, choose Signed. Verify its list starts at the top with its newest 10 or fewer. Return to All Orders: it should start again with the newest 10. Close/reopen the same category and verify the same reset.
4. **Attention banner:** If the banner is present, tap it. Verify the Needs attention list contains only change requests and declined orders. Check an order's existing response note/actions. Tap a category to leave this view. The banner is hidden when no responses need attention; this update does not introduce a new mark-as-read action.
5. **Declined under Pending:** Open Pending and verify declined orders appear there with their Declined label. Its total includes pending + changes requested + declined. All Orders continues to include them too.
6. **Totals:** Category counts, Total Approved and Direct Paid totals should represent the full account, not just the first 10. Loading more must not artificially increase those totals.
7. **Normal actions:** Open an existing signed test PDF and check it; open a draft through its existing edit action; check an existing response through its normal action. If you test archive/cancel, use only a disposable test order and confirm the list/count updates.
8. **iPhone:** Check header spacing; collapse all categories and confirm the small spring-back movement; expand a category and confirm only the order area scrolls. Check Load more is reachable and usable.
9. **Account switch:** Sign out and sign in with your other test account. Verify its counts/orders are its own. Switch back and verify your original account's orders return.
10. Report which checks passed and any error text. Local automated tests do not certify your hosted deployment; record these live results before closing this part of Gate 4.

## 6. If you need to roll back

Restore the previous `src/App.tsx` from the working commit recorded in Step 1, or revert this update's GitHub commit using your normal repository workflow, and let the frontend redeploy. The old dashboard does not use the new function. The additive function/index can remain while the problem is investigated; no signed data needs restoring and no old security policies need re-enabling. Do not drop existing media functions, tables or evidence.

## Local validation and scope

- Full automated suite: **63 tests passed across 18 files**. The adjusted profile-settings fixture was also rerun successfully after adding its dashboard-response mock.
- Typecheck and production build: **passed**, using non-secret placeholder public configuration for the local build. Keep your real deployed public configuration unchanged.
- Lint: **completed with one existing warning** about a thenable test mock in `tests/server-security.test.ts`. The existing large-bundle build warning remains.
- New tests exercise real PostgreSQL-compatible migration execution with owner RLS in PGlite, full totals above 1,000 orders, cursor ordering/ties, inserted orders between pages, denied anonymous/missing-user access, account/category response races, retry/background refresh, and the real dashboard component's filters and controls.
- No hosted migration, production deployment or physical-iPhone validation was performed by the assistant for this update.
- Existing media authorization, signed originals, logo treatment/resizing, email verification, payment and signature code are outside this change. Private-media stage 1 remains deployed based on your previous test reports; this release does not redo that work.
