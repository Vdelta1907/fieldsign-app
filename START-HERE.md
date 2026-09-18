# SignForth iPhone status-bar fix and elastic dashboard

This complete source ZIP retains the existing account isolation, account settings, branding, Stripe, order workflow, and dashboard features. It includes the previous elastic dashboard update and the revised iPhone status-bar approach described below.

## What changed

The iPhone screenshot showed the portal title and account control beneath the system's blurred status area. The earlier CSS cleanup retained the same 34px installed-app padding and did not resolve that overlap.

- `index.html` now requests an opaque `black` iOS status bar instead of `black-translucent`. This requests a content viewport below the system status bar rather than drawing the header beneath it.
- `src/index.css` removes the installed-iPhone 34px minimum. The header uses the normal 10px padding plus any remaining device-reported top safe area. In installed iOS dashboard mode, the app uses the locked root's available height rather than `100dvh`.
- The previous elastic dashboard work is retained: when all categories are collapsed, vertical touch/wheel gestures move the dashboard by at most 12px and it returns to its starting position. The document stays locked. Opening a category disables this effect and permits scrolling in the orders feed. Reduced-motion preferences are respected.
- `tests/mobile-shell.test.ts` checks the launch metadata; the gesture regression tests remain included.
- This instruction file and the README now reflect this release.

The intentional visual change is a separate, opaque iOS status-bar area above the orange header. Normal browser and Android header rules are unchanged. No Supabase SQL migration or Edge Function deployment is required.

## Upload and deploy

1. Keep the previous ZIP as a checkpoint.
2. Extract this ZIP.
3. Open the repository's `secure-foundation` branch in GitHub.
4. Upload the **contents inside** the extracted folder to the repository root, replacing matching files. Do not create an enclosing subfolder in the repository.
5. Commit with:

   `Fix installed iPhone status-bar overlap and retain elastic dashboard`

6. Wait for the Vercel deployment to succeed.

Keep existing Vercel environment variables and local `.env` values. This ZIP excludes real credentials, dependencies, generated build output, and the temporary local browser-test fixture.

## Refresh the iPhone installation

The status-bar setting is launch metadata. An existing Home Screen installation may retain the previous value; refreshing its page alone is not a sufficient test.

1. Finish and save any work in progress.
2. Open the deployed site in Safari and refresh it after deployment completes.
3. Remove the old SignForth Home Screen app/icon and add the refreshed site to the Home Screen again, using **Open as Web App** if that option is shown.
4. Launch the new icon and sign in if requested.
5. Confirm that the portal title and account button sit below the system status area and are sharp and fully visible. Test portrait and landscape.

Do not change/delete server-side accounts or orders to refresh the installation. If the blur remains, capture the new screen and record the iPhone model and iOS version. Desktop preview checks cannot reproduce the native iOS status-bar compositor.

## Focused behavior checks

- With all categories collapsed, drag the dashboard vertically: it should move slightly and return, without moving the page or header.
- Tap a category: it should open normally. A drag starting on a category must not accidentally activate it.
- Expand a category with enough orders to scroll. Scroll the orders feed and confirm that the header, totals, attention notice, and category buttons stay still.
- Collapse the category and check that the feed no longer scrolls.
- Check Account settings and Branding & Stripe Setup: normal page scrolling should still work.
- Check normal Safari and Android to confirm their existing layout is retained.

## Validation

Run locally with Node and npm installed:

```sh
npm ci
npm test
npm run build
npm run lint
```

The build command includes TypeScript checking. Validation completed for this package:

- 9 automated test files passed: 25 tests total.
- TypeScript checking and the Vite production build passed.
- Lint exited successfully with one existing warning in `tests/server-security.test.ts` (`unicorn/no-thenable`).
- Local browser checks used the real App with mocked account/order data at 375 × 768 and 390 × 785 available-content viewports. Installed-mode height matched each viewport; collapsed orders had hidden overflow. Expanded orders scrolled by 785px while the document remained at 0 and the summary position was unchanged.
- The browser checks simulate available content space and installed-mode detection; they do not emulate the native iOS status-bar compositor. The physical-device check above is still required.
