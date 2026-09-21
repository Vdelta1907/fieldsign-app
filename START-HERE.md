# SignForth — Gate 4 private media, stage 1

**September 21 authorization correction:** `prepare-order-media` now uses a dedicated secret. If you already reached the failed preparation request, start with `docs/PREPARATION-AUTH-FIX.md`; no SQL needs repeating.

This is the complete source for the existing reviewed SignForth project. **Start with `docs/PRIVATE-MEDIA-DEPLOYMENT.md`.** It contains the full numbered Supabase, GitHub, test and rollback instructions.

Deploy the new database migration and three named Edge Functions before uploading the frontend to GitHub. The guide identifies the exact files. Do not replay historical migrations or follow the older rate-limit deployment guide for this release: that milestone is already deployed.

This stage creates hash-verified private copies for signed orders and uses them in client receipt and contractor PDF reads. Original signed rows and evidence remain untouched. Current logo resizing, iPhone layout, elastic dashboard, signing, payments and email verification behavior remain intact.

New or unprepared orders retain their existing inline-media path. This is not completion of Gate 4 or a complete migration of future uploads. No production changes have been performed from this workspace.

- `docs/PRIVATE-MEDIA-DEPLOYMENT.md`: numbered user instructions.
- `docs/PRIVATE-MEDIA-RELEASE-NOTES.md`: changed files, validation and limits.
- `supabase/dashboard-private-media/`: self-contained function files and read-only checks for the Supabase Dashboard.
- `supabase/migrations/202609190001_private_signed_media.sql`: the ONLY new database migration to execute.
- `docs/gate4-client-rate-limits-history.md`: previous release history, not today's deployment instructions.

The archive contains source, tests and instructions; dependency folders, local credentials and build outputs are intentionally omitted. Existing production public environment variables must remain configured in Vercel.
