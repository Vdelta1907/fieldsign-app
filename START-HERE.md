# SignForth — dashboard pagination update

September 22, 2026: start with **docs/DASHBOARD-PAGINATION.md** for the current targeted deployment. Run only `supabase/migrations/202609220001_dashboard_pagination.sql` before deploying the listed frontend files.

This update adds 10-order batches, a clickable attention banner, newest-first category resets and declined orders under Pending. Only the files listed in the new guide need uploading to the existing GitHub repository.

Private-media stage 1 and its authorization correction were already deployed and user-tested in the preceding checkpoint. The older private-media deployment and preparation-auth guides remain as history; do not repeat their migrations, preparation batches, Edge Function deployments or temporary-secret setup for pagination. The temporary diagnostic function and preparation secret were removed after the earlier tests.

The pagination update has passed local tests/build/typecheck. Its hosted deployment and live acceptance checks remain pending. Full Gate 4 remains in progress. Keep existing environment variables, signing/payment flows, email verification and logo/iPhone behavior.
