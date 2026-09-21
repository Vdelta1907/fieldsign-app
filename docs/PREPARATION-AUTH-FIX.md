# SignForth preparation authorization fix — September 21, 2026

The diagnostic established: the header arrived, its Bearer format was valid, and the JWT's unverified role/project claims matched expectations, but its bytes did not match SUPABASE_SERVICE_ROLE_KEY in the runtime. This explains the original strict-comparison rejection. It does not establish why the keys differ or verify the supplied JWT's signature. Do not rotate project keys or trust decoded claims as authorization.

The revised administrative preparer requires a separate random 256-bit secret in x-signforth-media-secret. It retains the platform-provided service key only for its own database/Storage client. This separates permission to run this narrow task from the project's API-key representation. The two other media functions, frontend, database migration, original records and image-copy verification are unchanged.

## 1. Update only prepare-order-media

1. Open the supplied prepare-order-media.ts alongside this guide. Copy the complete file contents.
2. In the same Supabase project, open Edge Functions → prepare-order-media → Code.
3. Replace the complete index.ts contents with this file and select Deploy updates.
4. Confirm Verify JWT with legacy secret remains OFF. The dedicated-secret check inside the function authorizes the request.
5. Do not replace either other media function or rerun the SQL migration.

## 2. Create a private preparation secret

1. In Supabase, open Edge Functions → Secrets → Add new secret.
2. Enter this Name/Key first: SIGNFORTH_MEDIA_PREPARATION_SECRET.
3. On your Mac, open Terminal (Command–Space, type Terminal, press Return).
4. Paste the following command and press Return once:

```sh
openssl rand -hex 32 | tr -d '\n' | pbcopy
```

5. The command generates a 64-character random secret and copies it to your clipboard without displaying it. A new empty Terminal prompt is normal. Do not run the command a second time during setup: that would generate a different secret.
6. Return to Supabase's secret form. Click Value and press Command–V. Click Save. Keep this same clipboard value for the next section; do not copy other text yet. You may store it in your password manager for later administrative batches.
7. Never paste the secret into chat, GitHub, Vercel frontend settings or the request body.

Supabase supports adding custom production function secrets under Edge Functions → Secrets: https://supabase.com/docs/guides/functions/secrets

## 3. Run the request with the new header

1. Open prepare-order-media → Test, choose POST and keep the body {}.
2. Remove your manually entered Authorization header. This tool no longer authorizes callers by comparing that header to a service-role JWT.
3. In Header name, TYPE x-signforth-media-secret by hand so you do not replace the clipboard.
4. In Header value, press Command–V to paste exactly the same secret saved above. Do not add Bearer or quotation marks.
5. Click Send Request once and wait. A valid request starts a real preparation batch, at most five signed orders, as previously authorized.
6. Expected: HTTP 200 with processed, remaining, prepared, references and unique_objects. Share only that response.
7. If 503 says “Media preparation secret is not configured correctly,” confirm the exact secret name and a 64-character lowercase hexadecimal value. If 403 says “Administrator authorization required,” the custom header is missing or does not match the saved secret. These failures do not make copies. Do not change the global Supabase keys.
8. Other 503 errors may describe database/upload/verification failures after authorization: stop and share the controlled error/counts rather than bypassing verification.

## 4. Resume the deployment

After a successful batch, repeat one request at a time until remaining is zero. Then run the progress and before/after original-record fingerprint checks from step 7 of the main guide. Keep GitHub deployment pending until they match.

Use the revised complete source ZIP ending in Auth-Fix for the eventual GitHub upload; its source and deployment instructions include this correction. Do not rerun already successful SQL or redeploy the other functions just because the ZIP was refreshed.

After diagnosis is resolved, delete only the temporary diagnose-media-auth function. The production preparer is prepare-order-media; keep their names distinct. Once preparation and verification are complete, removing SIGNFORTH_MEDIA_PREPARATION_SECRET disables further batches without affecting app reads; set a fresh random value if maintenance batches are needed later.

Local validation: 55 tests across 15 files pass; source and standalone Edge TypeScript checks pass; lint has only the existing warning. No live deployment or successful copy is claimed by this patch. The administrator applies the steps above.
