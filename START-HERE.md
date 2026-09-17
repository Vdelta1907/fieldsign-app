# SignForth dashboard lock refinement

This complete source folder is based on the latest `secure-foundation` version. It contains the previously completed account-isolation, Account Settings, branding, Stripe, default-logo, placeholder, and dashboard work, plus the three refinements from the latest physical-device test.

## What changed in this update

1. The account-deletion warning now uses real line breaks. The prompt no longer displays the characters `\n\n`.
2. iPhone Home Screen mode is detected through `navigator.standalone`, rather than depending only on an unreliable CSS media query. Only that mode receives the additional top spacing; Android and normal Safari retain their existing layout.
3. Dashboard mode now locks the browser document itself. The header, totals, attention notice, and order categories remain stationary. Only the expanded orders feed can scroll. The lock is removed automatically when the user leaves Dashboard.

## Upload and deploy

No Supabase SQL migration or Edge Function deployment is required for this update.

1. Keep a copy of the current working ZIP as a checkpoint.
2. Extract this ZIP.
3. In GitHub, open the `secure-foundation` branch—not `main`.
4. Upload the **contents inside** the extracted folder to the repository root. Do not upload the enclosing folder as a new subfolder.
5. Allow GitHub to replace files with matching names.
6. Commit directly to `secure-foundation` with:

   `Fix iPhone dashboard spacing and lock orders feed`

7. Wait for the Vercel production deployment to finish successfully.

Keep the existing Vercel environment variables and local `.env` values. The ZIP contains no real credentials and excludes `node_modules` and generated build output.

## Focused tests after deployment

### 1. Account-deletion warning

- Open **Account settings**.
- Tap **Request account deletion**.
- Confirm that there is a blank line after “Request account deletion?” and that `\n\n` is not printed.
- Tap **Cancel**. The deletion form should remain closed.

### 2. iPhone Home Screen spacing

- First refresh `https://fieldsign-app.vercel.app` in Safari after the new Vercel deployment.
- Remove the older SignForth Home Screen icon and add it to the Home Screen again. This prevents an old installed copy from obscuring the result.
- Open the installed app and confirm that the contractor header is fully below the status area, with no cropping or blur.
- Confirm that normal Safari and Android still look unchanged.

### 3. Stationary dashboard and scrolling orders

- Open Dashboard and expand any category containing enough orders to scroll.
- Swipe vertically inside the orders feed. Orders should move.
- The SignForth header, navigation, totals, attention notice, and all four category buttons must remain in the same position.
- Try swiping over the stationary summary area. The outer page must not move.
- Open **Account settings** or **Branding & Stripe Setup** and confirm those pages scroll normally; the document lock applies only to Dashboard.

## Validation completed before packaging

- 7 automated test files passed (20 tests total).
- TypeScript and the Vite production build passed.
- A 390 × 844 mobile browser check forced an outer-page scroll attempt. The document remained at position `0`, the summary coordinates did not move, and the orders feed moved to position `500`.
- That check also confirmed the iPhone Home Screen class, a 34px top inset, fixed document positioning, and hidden root overflow.

The browser check uses mocked account data and does not modify production users, orders, Stripe accounts, emails, or payments. The final iPhone check must still be completed on the physical device because desktop browser emulation cannot reproduce every installed-Safari behavior.
