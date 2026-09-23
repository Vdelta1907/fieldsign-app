# SignForth — targeted new-upload storage update

September 23, 2026. Start with **docs/NEW-UPLOADS-DEPLOYMENT.md**. This release is prepared locally, not yet deployed.

Deploy only the new **202609230001_future_private_media.sql** migration with writes initially disabled, then the three standalone Edge Functions named in the guide, then the targeted GitHub/frontend files. Verify readers/original fingerprints before running the separate enable script. Existing private-media stage 1 and pagination deployments remain credited; do not repeat their migrations or preparation batches.

No new secrets are required. Keep approved branding, logo processing, email verification, payments, signed originals and iPhone/dashboard behavior. Use the write-disable script if necessary; keep reference-aware readers installed after new references exist.

The package manifest identifies every replaced/added file. Tests/build/typechecks are local evidence; user deployment/live checks remain pending. Full Gate 4 remains in progress.
