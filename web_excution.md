# Web beta execution plan

## Goal and architecture

Launch a low-cost, account-based web Notlinear while preserving existing features and Settings. All currently available features default on; existing unfinished features retain their off defaults.

- Reuse React and FastAPI; deploy to Google Cloud Run using eligible trial credits.
- Supabase email/password Auth and PostgreSQL own accounts and cloud records.
- Private Cloudflare R2 owns attachments, replacing Supabase Storage.
- Users bring supported subscription access or API keys. No Notlinear-funded AI fallback.
- Keep desktop runtime/local databases compatible and separate.
- Provide an online-first installable PWA/desktop shortcut.

## Centralized feature flags

Administrators control environment-specific global flags through Settings, without rebuilding. Bootstrap administrator identity from server-configured Supabase UUIDs, never editable user metadata. Audit each change with version, administrator and timestamp; reject stale writes.

Load flags before navigation. Refresh on focus and every 60 seconds. Backend authorization and flag gates remain authoritative even if a browser changes its flags. Desktop keeps a local configuration adapter.

| Group | Controls |
| --- | --- |
| Workspace | Chats, branches, highlights, Canvas, Notes, Projects, Sketch, artifacts, attachments and search |
| AI | Each API provider, subscription connection, research tool, voice and context ranking |
| Settings | Settings entry point, Models & keys, Skills, Integrations, Modes, Product updates and Runtime logs |
| Subfeatures | Clarification, chat-to-Notes, linked folders and existing experimental flags |

Disabling Notes hides its sidebar, Project cards/drill-ins/add menus, open/restored views, context and AI actions. chat-to-Notes requires Notes and Chats. Disabling Projects removes organization without disabling independent content. Disabled features remain stored; re-enable restores access. Direct actions and backend operations must also be guarded.

Preserve drafts and partial output when disabling active work, cancel affected generation and choose an enabled surface or neutral home. Keep General account/admin recovery accessible when ordinary Settings is off. Existing Settings layouts stay intact except flag visibility and accurate cloud-storage wording.

## Accounts and cloud persistence

Signup/sign-in/logout/password recovery/account deletion; signup email confirmation disabled initially. Validate account identity before selecting its cache. Apply ownership to every operation; credentials stay outside workspace records, logs, analytics and exports.

Use versioned resources preserving IDs/relationships across chats, branches, Notes, Canvas, Projects, Sketch, artifacts and annotations. Browser IndexedDB is an account-scoped cache/draft buffer. Clear account memory on logout. Cloud is authoritative; show Saving/Saved/Save failed and reject conflicting revisions. Preserve local drafts and provide explicit recovery instead of overwriting.

Desktop import is explicit, repeatable and non-destructive. Export and disaster restoration include database records and file bytes. Keep desktop data/schema untouched.

## Private R2 attachments

Separate staging/production buckets and secrets. Store ownership, permanent object key, name, type, size and lifecycle state in PostgreSQL. Authorize upload reservations, completion, download and deletion. Use short-lived signed URLs with restricted CORS; never persist expiring URLs as document references.

Bind size/type to upload signatures; verify completion and file signatures. Reject oversized/incomplete files. Clean abandoned reservations, retry deletions and preserve references across previews/provider context/Notes media/import/export. Defaults: 10 MB/file, 100 MB/user; an additional 200-object beta cap bounds request costs.

## Runtime and AI connections

Explicit desktop/cloud modes. Cloud must never invoke native pickers, interpret user paths on the server or share local agent credentials/process sessions. Browser folders upload selected snapshots. Explain capability differences.

Encrypt saved provider credentials server-side. Bound generation time/concurrency, preserve partial answers and keep durable ownership/leases. Supported hosted subscriptions require provider approval and a configured remote adapter; a local working companion does not establish eligibility. If unavailable, the first beta supports user-owned API keys.

## First-use experience

Welcome -> account -> connect supported AI access -> real first task -> first answer -> contextual branch guidance -> return/save -> complete workspace. Do not require a project/theme/model choice first. Resume after cancellation/reload. Users without a connection can read/export saved work. Connection loss never deletes or blocks access to saved content.

## Execution status

| Phase | Status / acceptance |
| --- | --- |
| 0. Plan, inventory and baseline | Plan committed; feature mapping in deploy/FEATURE_FLAGS.md; baseline/regression evidence recorded |
| 1. Flag system and admin controls | Implemented; Notes removal/re-enable, Settings and direct API authorization tested |
| 2. Accounts and persistence | Implemented; account identity, resource roundtrip and revision conflict tests pass; live two-account staging gate remains |
| 3. R2 adapters | Implemented; signing and mocked lifecycle checks pass; live R2/browser/restore gate remains |
| 4. Providers and onboarding | Implemented for supported API adapters; mocked signup/connect/answer/save/reload checks pass; hosted subscriptions remain gated |
| 5. Staging and rollout | Not deployed: Supabase/R2/GCP configuration and live validation still required |

## Verification and rollout

Verify all-enabled parity, flag dependencies and entry points, non-admin rejection, direct disabled APIs, two-user isolation, cache/account switching, save conflicts/retries, partial streams, upload expiry/quota/cleanup, export/import and backup restoration. Run existing feature regressions in applicable runtime modes. Real provider/native/clean-Mac checks are separate from mocks.

Start with 20 invited users. Track connection, first answer, branch, save, return and errors without private content. Review compute/database/R2 costs weekly, cap scaling/uploads, configure budget alerts and decide before Google credit expiry. Keep production publication separate from staging; retain rollback revisions and flags.

Operator setup: deploy/WEB_BETA.md. Results and remaining live gates: deploy/VALIDATION.md. Public releases, installed desktop data and the website remain unchanged by this branch.
