# Desktop / DMG parity audit — 2026-11-11

## Correct baseline

The real desktop app is `/Users/yash/Downloads/notlinear`, branch `canvas/tesing-codex`,
commit `3529b689eeb18cc9e021850a829c5cd9f5942e49`. The Desktop launcher loads `/web/`.
Its active frontend is React/TypeScript/Vite, with FastAPI and an optional subscription companion.

**The 0.2.0 and 0.2.1 drafts are obsolete.** They packaged the retired vanilla frontend and stdlib
backend. Their prior byte comparisons proved only that they matched the wrong release worktree.

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
- Actual package HTTP/manifest/runtime/security checks: 5 passed.
- Full browser suite against packaged assets/backend: running; final result in RUNS.md.
- Settings screenshots: captured by the packaged audit spec after browser verification.
- Mounted final image / uploaded asset hashes: pending final candidate packaging.

No real provider request, account login, macOS microphone/Screen Recording grant, or actual native
file/save dialog is claimed as verified by browser mocks. No user IndexedDB state or credentials
are read, copied, cleared or migrated. Automated browser storage and server files are isolated.
