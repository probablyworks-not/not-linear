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
