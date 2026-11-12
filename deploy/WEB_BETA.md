# Web beta operator guide

## Local implementation versus deployment
This is a new cloud runtime, not a change to the installed desktop application's databases. Never deploy with desktop mode enabled. The public site, existing releases, production database and DNS have not been changed.

## Provision staging
1. Create a separate Supabase project. Use a different project for production; an environment flag name alone does not isolate workspace content. Apply supabase/migrations/202611120001_web_beta.sql. Tables and RPCs are inaccessible to anon/authenticated database roles; all writes go through the authenticated backend, which supplies verified ownership. Service-role credentials never enter the browser.
2. Enable email/password Auth and disable Confirm email as requested. Configure site URL and password recovery redirect. Configure SMTP for recovery emails. Add the maintainer's authenticated user UUID to NOTLINEAR_ADMIN_IDS. Do not use user metadata for administrator authorization.
3. Create a private R2 bucket and scoped S3 credentials. Apply deploy/r2-cors.json with the actual staging origin. Do not enable r2.dev/public access. Production needs a separate bucket and credentials.
4. Configure values from deploy/cloud.env.example via Cloud Run environment and Secret Manager. Generate NOTLINEAR_CREDENTIAL_KEY with cryptography.fernet.Fernet.generate_key(); preserve it with backups, never commit it. No provider API keys belong in application environment defaults.
5. Build with `docker build -f deploy/Dockerfile -t notlinear-web .`. Supply no secrets as build arguments. Deploy staging with max instances 2, min instances 0 and request timeout 360s. Restrict public origins to the exact HTTPS app origin. Configure budget alerts and monitor R2 operations/storage separately from Google credits.
6. Hosted subscription providers remain unavailable until an approved integration exists; local callback/credential files are never reused. Existing API-key users can use supported cloud proxy providers. No company-funded fallback exists.

## Validation before users
Run frontend typecheck/lint/unit/production build, cloud HTTP tests, feature-flag browser tests and existing desktop browser regressions. Then run live tests with two distinct Supabase users: all resource/file/credential ownership boundaries, reconnect/recovery, simultaneous revisions, R2 size/type/quota failures, and representative provider streams/cancellation/rate limits. Mocked tests are not a substitute for these live checks.
Check every enabled feature's cloud capability, especially native folder replacement, voice, Notes embedded media, exports and long Canvas documents. Run full desktop regression after cloud changes.

## Backups and restoration
Export PostgreSQL using the Supabase CLI and copy private R2 objects to a separate private backup location. Database exports do not contain file bytes. Keep encrypted credential backups and their encryption key separate. Test restore in a fresh staging project/bucket and compare resource revisions, attachments and relationships before calling backups verified. Never expose provider ciphertext or credentials in user exports.

## Rollback and launch
Keep the previous Cloud Run revision. Roll back application traffic without reverting database data; disable affected features through admin Settings. Existing records remain intact when flags change. Start with 20 invited users, record connection/first-answer/branch/save/return/error events without message content and review costs weekly. Publish only after separate approval. Decide whether to continue before Google trial expiry.

## Implemented locally
- Runtime feature registry and global admin Settings with audit/version checks, focus/60-second refresh, dependency resolution and guarded UI/actions/API operations. Existing available defaults remain enabled.
- Email/password signup/sign-in, verified account identity on reload, recovery completion, logout and deletion. Account-scoped browser caches and encrypted provider credentials.
- Individually versioned chats/Notes/Projects/artifacts, Canvas/Sketch records, annotations and preferences. Canonical hashed sync fingerprints, optimistic conflicts, local draft export and explicit cache recovery.
- Private R2 upload reservations, signed size/type, completion verification, file signatures, download/deletion, daily orphan cleanup and atomic reference tracking; embedded Notes/chat media externalized while preserving local schemas.
- User export downloads actual file bytes; cloud/desktop backup import preserves existing records, remaps attachment references and merges thread indexes. Local unsynced drafts are included separately for manual recovery.
- Guided account/connect/task/answer/branch/saved onboarding; metadata-only product events and cloud diagnostics; online-first manifest/service worker and browser install help.
- Cloud Run container/build configuration. Native filesystem/shared local agents are unreachable in cloud mode. Browser folder selection uploads a snapshot, not a live filesystem link.

## External gates and limitations
- Authentication sessions are per browser window; reopening an installed shortcut may require sign-in. Workspace content remains cloud-backed.
- No live Supabase/R2/GCP credentials are configured. Actual provisioning, GoTrue email delivery/recovery, live R2 CORS/signatures, cloud deployment and disaster restore remain unverified.
- Hosted subscription providers remain capability-gated. Provider approval and an approved remote adapter are required; the local companion is not deployed. User-owned API keys support the initial beta.
- The Other/custom-key card is retained, but custom endpoints do not yet have an approved cloud proxy adapter. SearXNG uses the user's browser and requires the selected endpoint's CORS support; it never grants server filesystem/network access.
- Existing preview integrations and experimental defaults retain their prior status. A feature flag cannot make an unfinished integration functional.
- Import skips existing content IDs rather than overwriting them. Local conflict drafts are separately exported for manual reconciliation. Automated conflict merging is intentionally absent.
- The installed Mac app's existing data has not been migrated or modified. No new DMG, public website change or public deployment was performed.
- Docker tooling is unavailable locally; container build/start and browser installation on Windows/macOS must be checked in staging. Cloud Run execution needs the configured allowed origin and secrets.

## Reproducible checks
- Frontend: `cd web && pnpm run typecheck && pnpm run lint && pnpm test && pnpm run build`.
- Backend: install requirements-cloud.txt plus requirements-dev.txt into an isolated venv; run `python -m unittest discover -s tests -p test_cloud_beta.py -v` and `python -m pytest tests/contract tests/proxy`.
- PostgreSQL: with PostgreSQL 16 tools on PATH, run `python scripts/test_cloud_sql.py`. This creates and removes a disposable local cluster, not a hosted Supabase project.
- Browser: `cd web && pnpm exec playwright test`. Tests use port 8766 and isolated browser data. Cloud specs mock external services; live provider requests are not implied.
- Final local results and discovered/fixed issues: see deploy/VALIDATION.md.

## Build and staging deployment
Choose the Google project and a region near the Supabase database. Create an Artifact Registry Docker repository first. Then run:

```sh
gcloud builds submit --config deploy/cloudbuild.yaml --substitutions _IMAGE=REGION-docker.pkg.dev/PROJECT/REPOSITORY/notlinear:REVIEW_SHA
```

Create the Cloud Run service with that image, min instances 0, max instances 2, timeout 360 seconds, exact allowed HTTPS origin, and environment/secrets from cloud.env.example. Grant the runtime service account access only to its required Secret Manager secrets. Never use the service-role key in the frontend build.

Schedule `python -m cloud.maintenance` daily as a Cloud Run Job with `PYTHONPATH=backend` and the same environment-specific storage/database credentials. It cleans expired pending and unreferenced completed objects, retries deleting objects and prunes diagnostics/events older than 30 days. Default upload limits are 10 MB/file, 100 MB/user and 200 objects/user, including pending reservations.
