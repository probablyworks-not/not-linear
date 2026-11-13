# Web beta validation — 2026-11-12

## Local results

| Check | Result |
| --- | --- |
| TypeScript / production Vite build | Pass; existing large-chunk warnings remain |
| ESLint | Pass |
| Vitest | 908 tests / 100 files pass |
| Existing backend contracts and proxy tests | 170 collected; suite passes in isolated cloud dependency environment |
| Cloud HTTP/security/storage tests | 18 pass; Supabase/R2 mocked |
| Local PostgreSQL 16 migration | Pass: revision conflicts, private grants/RPCs, feature audit, quota reservation, generation leases, owned file references and safe deletion/orphan selection |
| Broad browser regression | 334 pass, 1 package-only skip, 1 startup shortcut race discovered |
| Final targeted browser run | 37 pass, including corrected shortcut, Notes/sidebar/Projects/Settings flags, cloud signup, credential references, streamed answer/reload, Notes, attachments and Sketch |
| R2 signing | Local SDK check passes: size/type signed, 300-second expiry; no live request |

The startup shortcut race was fixed by buffering supported shortcuts during asynchronous application bootstrap. Cloud sync tests also found and fixed a Dexie ready-event deadlock. Separate tests cover edits arriving during an in-flight cloud pull, background Canvas cancellation, recovery links superseding expired sessions, verified account identity rather than client-cached user IDs, stale-write preservation and canonical fingerprints under PostgreSQL JSON key reordering.

Mocked provider responses incur no AI usage. Tests use isolated browser/temporary database state. No personal credentials, local desktop IndexedDB data, primary Downloads checkout, public release or live website was modified. The disposable PostgreSQL clusters were shut down and removed.

## Reproduction
Commands and environment setup are in WEB_BETA.md. scripts/test_cloud_sql.py uses a disposable cluster and PostgreSQL binaries from PATH (or NOTLINEAR_PG_BIN). Cloud dependencies were installed in /tmp/notlinear-cloud-review-venv; regression logs are /tmp/notlinear-web-*.log and /tmp/notlinear-cloud-*.log.

## Not verified / launch gates
- Live Supabase Auth/PostgREST, actual project migration, recovery email delivery and two-account end-to-end hosted operation.
- Live R2 CORS, signed browser uploads/downloads, quota cleanup and portable backup restore.
- Real provider calls, cancellation/expiry/rate limits, hosted subscription eligibility and any approved remote adapter.
- Docker image build/start, Cloud Run deployment, secrets/permissions, budget alerts and disaster-recovery drill.
- Real Windows/macOS browser installation, clean-Mac desktop packaging and exhaustive flag combinations.

Staging must pass these checks before invitation rollout; production publication remains a separate approval. Existing desktop source behavior is covered by regression tests, but a fresh DMG has not been generated for the web-beta branch.

## Visual review

Captured and inspected `dist/web-beta-review/workspace-onboarding.png` and `admin-feature-flags.png`. The connection step is a dedicated zero screen; subsequent guidance is inline so it does not obstruct the composer. Account controls remain reachable above Settings, including when ordinary Settings navigation is disabled.

## Configuration recheck — 2026-11-13

Fresh local checks passed: TypeScript, ESLint, production build, 908 frontend tests, 20 cloud API tests, 170 backend regression tests, 11 targeted browser checks (cloud onboarding/admin, shortcuts and feature flags), and the disposable PostgreSQL migration/security suite. Cloud/browser specs use mocked external services; they do not establish live account or attachment readiness.

Read-only live checks using the private root `.env` found:
- Supabase Auth settings respond HTTP 200 and email signup is enabled, but `mailer_autoconfirm` is false. Disable Confirm email for the requested initial signup flow.
- The configured project returns HTTP 404 / PGRST205 for `feature_configuration`: the required application schema is not available through PostgREST. Apply `supabase/migrations/202611120001_web_beta.sql` in that staging project's SQL editor, then recheck.
- The configured R2 bucket check returns HTTP 403. Verify account ID, bucket name and S3 Access Key ID/Secret Access Key, with Object Read & Write permission scoped to this bucket. CORS and live object operations remain unverified because this check failed.
- `NOTLINEAR_ADMIN_IDS` is empty. After creating the maintainer account, configure its Supabase Auth user UUID to enable admin feature controls.
- Google deployment identifiers are empty; these are unnecessary for local testing.
- The encryption key has valid Fernet format and `.env` remains owner-only (0600). No secret values were printed.

No hosted configuration, users, objects or application data were changed by these read-only checks. No real AI calls were made. Live two-account persistence, browser R2 uploads/downloads, recovery mail and real provider streaming remain launch gates. The previously screenshot-exposed encryption key must be replaced before storing real credentials if unused, or migrated safely if already in use.

### Follow-up live checks
Supabase application schema now responds HTTP 200 and R2 object-list access passes. R2 signed-URL browser preflights for PUT and GET return HTTP 204 and accept the local origin `http://127.0.0.1:8767`. No files were uploaded by these checks. Email auto-confirm was still false at the last Auth settings check. Browser subscription choices remain disabled pending actual hosted integrations; the revised onboarding and admin browser specs both pass, with build and lint passing.
