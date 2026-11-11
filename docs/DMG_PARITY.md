# Desktop / DMG parity audit — 2026-11-11

## Correct baseline

The real desktop app is `/Users/yash/Downloads/notlinear`, branch `canvas/tesing-codex`,
commit `3529b689eeb18cc9e021850a829c5cd9f5942e49`. The Desktop launcher loads `/web/`.
Its active frontend is React/TypeScript/Vite, with FastAPI and an optional subscription companion.

**The 0.2.0 and 0.2.1 packages contain the obsolete UI.** They packaged the retired vanilla frontend and stdlib
backend. Their prior byte comparisons proved only that they matched the wrong release worktree. On the final GitHub check, v0.2.1 is already public; this correction leaves it unchanged and prepares v0.3.0 as a separate review draft.

## Corrected candidate

Version 0.3.0/build 5 builds `web/dist`, serves `/web/`, and bundles the current backend,
FastAPI/uvicorn/httpx/PDF dependencies, subscription SDKs and Claude companion binary, backup tools,
logo, changelog and third-party notices. The runtime contains no user credentials or databases.
Native startup explicitly uses the packaged interpreter/companion and disables the Vite dev proxy.
The release manifest records compiled/source file hashes and the exact source commit.

## Feature checklist

| Area | Included source / verification |
| --- | --- |
| Settings | Current seven-tab SettingsPage: General, Models & keys, Skills, Integrations, Modes, Product updates, Runtime logs |
| Subscriptions | Current Claude/ChatGPT controls; bundled Python SDKs and Claude CLI; new account sign-in still required on another Mac |
| Chat / branches | Current React chat, nested branches, attachments, provider controls and persistence implementations |
| Canvas | Current threads, source anchors, hierarchy, reader, annotations and synthesis implementation |
| Notes | Current BlockNote editor, separate Notes DB, backup endpoint and export/import tools |
| Projects / context | Current project rules, file/folder context, PDF scanning and permission ledger |
| Voice | Current voice frontend and AssemblyAI endpoint; real microphone/API use is a manual check |
| Updates / logs | Current product history/log UI plus native release checks; logs write outside bundle |
| User data | Same bundle ID and 127.0.0.1:8765 origin; no schema changes relative to desktop baseline |

## Verification status

- Production frontend build/typecheck: passed.
- Current unit suite: 891 passed.
- Backend contract/proxy/server checks: passed (native/network dependencies mocked by fixtures).
- Lint: passed after regenerating the merged changelog fallback.
- Actual package HTTP/manifest/runtime/security checks: 6 passed, repeated successfully from the read-only mounted DMG.
- Broad packaged browser suite: 329/330 passed; the sole stale Settings expectation was corrected. All 18 targeted Settings/audit checks then passed.
- All seven Settings screenshots captured and visually reviewed; Product updates audit waits for actual release cards.
- Mounted final image: metadata, Applications shortcut, all payload hashes, bundled SDK imports/certificates, Claude CLI and post-use deep signature passed. Remote review asset hashes recorded in RUNS.md.

No real provider request, account login, macOS microphone/Screen Recording grant, or actual native
file/save dialog is claimed as verified by browser mocks. No user IndexedDB state or credentials
are read, copied, cleared or migrated. Automated browser storage and server files are isolated.

## Review artifact

- Version 0.3.0 / build 5, Apple Silicon, ad-hoc signed and unnotarized.
- Runtime source commit: `29b645e410ff150c016f584f1dcd541fdf184bf1`. Later review documentation/test-only commits do not alter the artifact.
- Local DMG: `dist/release-v0.3.0/Notlinear-0.3.0-arm64.dmg`.
- Source comparison: 307 active React files match desktop baseline except generated merged changelog fallback; no feature code omitted.
- Public publication and website changes are not part of this correction.

Review links: [draft release](https://github.com/probablyworks-not/not-linear/releases/tag/untagged-9836cf87427ce14cd201), [draft PR #3](https://github.com/probablyworks-not/not-linear/pull/3). All three uploaded asset digests match local files.
