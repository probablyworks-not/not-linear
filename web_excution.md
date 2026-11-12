# Web beta execution

## Accepted architecture
React + FastAPI on Cloud Run; Supabase email/password Auth and PostgreSQL; private Cloudflare R2 attachments. All existing available features stay enabled. Existing experimental defaults stay unchanged. Desktop storage and local runtime remain supported. Users bring supported subscriptions or API keys; no funded AI fallback.

## Execution checklist
- [ ] Central typed registry, audited persistent environment-specific admin flags, refresh on focus/60s, server enforcement.
- [ ] Hide disabled features in navigation, Projects, Settings, menus, search, shortcuts, tabs, context and AI actions; preserve data.
- [ ] Account signup/sign-in/logout/recovery/deletion; administrator IDs configured server-side.
- [ ] Account-scoped local caches, versioned cloud records, visible save state/conflicts, export/import.
- [ ] R2 upload reservation/completion/download/deletion, ownership/quota/type/size checks and cleanup.
- [ ] Cloud/desktop separation; no native filesystem or shared local provider credentials in cloud mode.
- [ ] Encrypted user credentials, authenticated provider execution, bounded streaming/cancellation.
- [ ] Resumable welcome/account/connect/task/answer/branch/saved onboarding.
- [ ] Online-first PWA, deploy/rollback/backup documentation, private beta metrics.
- [ ] Unit/integration/browser regression tests and explicit live-service validation.

## Flags
Workspace: chat, branches, highlights, canvas, notes, projects, sketch, artifacts, attachments, search.
Settings: settings, models, skills, integrations, modes, changelog, logs.
AI: individual API providers, subscription providers, research tools, voice, context ranking.
Subfeatures: clarify, chatNotes, linkedFolders, projectMemory, designs.
Administrators control all users through Settings. Notes off also disables chat-to-Notes, sidebar/project cards, search/actions and note context; no deletion. Projects off removes organization only. No enabled workspace shows a neutral home. General account/admin recovery stays accessible.

## Cloud data
Keep existing IDs/relationships. Cloud is authoritative; account-scoped IndexedDB caches/drafts; credentials excluded. Optimistic revisions reject conflicts. Import is explicit, repeatable and non-destructive. Export/deletion and backup restore include files.
R2 private buckets per environment; metadata in PostgreSQL; short-lived signed URLs; permanent object IDs in records. Defaults: 10 MB/file, 100 MB/user. Reject incomplete/oversized/type-invalid files, clean abandoned uploads and retry deletion.

## First-use flow
Welcome -> account -> supported subscription or own API key -> real task -> first answer -> contextual branch guidance -> return/save -> full workspace. No mandatory project/theme/model setup. Reading/export remains available without AI. Hosted subscription support must be independently approved/configured; local prototype is not proof of hosted eligibility.

## Acceptance and rollout
All-enabled desktop parity; flag combinations/dependencies/re-enable; non-admin rejection; two-account isolation; refresh/second device; conflict/retry/partial-stream recovery; R2 unauthorized/expiry/quota/cleanup; export/import/restore; real provider checks separate from mocks. Start with 20 invitees; measure connection/answer/branch/save/return/failures without content. Monitor compute/database/R2 weekly. Spending alerts, low scaling, and credit-expiry decision. Public release requires separate approval.

## Status reporting
Implementation status and required external configuration are recorded in deploy/WEB_BETA.md. Do not mark cloud-service or live-provider tests passing without running them.
