# Free macOS distribution

Status: 2026-11-01. The user chose a free, ad-hoc-signed, unnotarized DMG.
Apple Developer membership, Developer ID, notarization, and Sparkle are not required for this beta path.
This supersedes the earlier proposal that made paid signing a release prerequisite.

## Destinations

- GitHub source and releases: https://github.com/probablyworks-not/not-linear
- Existing website: https://notlinear.lol/ (Vercel).
- Proposed download page: https://notlinear.lol/download/
- Native update feed: https://github.com/probablyworks-not/not-linear/releases/latest/download/latest.json

The Vercel website's source repository/project still needs to be identified. `release-site/download/`
is ready to copy into its public/static directory. Do not replace or migrate the existing site.
The public website currently links to a different repository; its download links need deliberate correction.
No website/domain configuration has been changed by this work.

## Build

On macOS with Command Line Tools and a python.org Python framework:

```sh
python3 scripts/build_macos.py \
  --python-framework /Library/Frameworks/Python.framework/Versions/3.13 \
  --output dist/free-beta/Notlinear.app --arch arm64 --version 0.2.0 --build 3 --dmg
```

Alternatively use `launchers/build-macos-app.command` with `NOTLINEAR_PYTHON_FRAMEWORK` set.
The builder refuses to overwrite outputs; choose a fresh directory for another build.
If disk-image creation must run separately:

```sh
python3 scripts/build_macos.py --output dist/free-beta/Notlinear.app --dmg-only
```

The app contains frontend/backend, changelog, and a trimmed relocated Python runtime.
No source checkout or system Python is needed at runtime. Personal logs/feedback/uploads,
installed Python packages, debug pages, and databases are excluded. The frontend still uses
CDN libraries/fonts (and the PDF feature dynamically loads PDF.js); this beta requires internet.
The app and nested native runtime code use ad-hoc signatures, not an Apple-verified publisher identity.
Python/third-party license review and offline asset bundling remain follow-up release work.

## Installation and updates

Users open the DMG, drag Notlinear into Applications, and enter their provider key in Settings.
If macOS blocks opening, users who trust the download may approve it through System Settings →
Privacy & Security → Open Anyway, where available. Managed Macs can disallow this.
Link to Apple's instructions: https://support.apple.com/102445. Never ask users to disable Gatekeeper globally.

Native updates check on launch and every six hours; the app menu also has **Check for Updates…**.
Only public release metadata is requested—no API keys, chat content or device identifiers.
`latest.json` contains `app`, numeric `version`, monotonically increasing integer `build`,
`notarized:false`, and `downloads.arm64.{url,sha256}`. The validator requires a GitHub HTTPS DMG
URL inside this exact repository and rejects malformed fields and unsupported architectures.
Automatic checks remain quiet on failures and avoid repeating a dismissed build during the same session.
A newer build shows **Download Update / Later**. Download opens the release asset in the browser;
there is no automatic installation, restart, workspace clearing or active-response interruption.
The user finishes work, quits, and replaces the app in Applications. Bump BOTH version and build
for each release. Keep old release assets available. The latest feed is served as a release asset,
so publishing a complete release updates downloads and metadata together.

## Prepare and upload a draft

```sh
python3 scripts/prepare_macos_release.py \
  --app dist/free-beta/Notlinear.app \
  --dmg dist/free-beta/Notlinear-0.2.0-arm64.dmg \
  --output dist/release-v0.2.0 --tag v0.2.0
```

This verifies signatures and the image, copies a versioned DMG, computes SHA-256, and creates
`latest.json`, `SHA256SUMS.txt`, and installation/update release notes. A QA bundle ID is rejected.
Use an explicit remote commit SHA/ref and `--upload-draft` to create a GitHub draft with its assets.
The script NEVER publishes a release, overwrites an existing staging directory, or merges source changes.
Review the actual artifact and source changes before publication, per AGENTS.md.

After the smoke/upgrade checks pass and the maintainer approves, publish that GitHub draft as a
regular release (not a prerelease, because GitHub's `/latest` endpoint excludes prereleases).
The title/notes can still clearly identify it as an early beta. The download page finds the arm64
DMG through GitHub's public Releases API. Before the first publication or on API failure, it retains
a working Releases link rather than pretending there is a downloadable version.
Do not silently turn the source repository private: public unauthenticated downloads/feed depend on it.

## Data and security

- Bundle identity: `local.notlinear.app`; local origin: `http://127.0.0.1:8765`.
- Chats/Notes: existing, separate persistent WKWebView IndexedDB databases. Schemas and keys unchanged.
- Keys: existing local browser storage; Keychain migration is not implemented or claimed.
- Writable files: `~/Library/Application Support/Notlinear/` (`logs.md`, `server.log`, `feedback/`).
- Code/runtime: inside app Resources; not written at runtime.
- Development server still defaults to repo-relative logs/feedback.
- `NOTLINEAR_PACKAGED=1` enforces local Host/Origin checks and removes permissive CORS in packaged mode.
  Existing endpoint names, payloads, and relative media/doc URLs remain unchanged.
- Native file/save messages require the main frame's exact local origin; external main-frame pages
  open in the browser instead of inheriting the app's native bridge.
- Launcher owns only its child backend and checks its PID via `/__notlinear_health`.
  A port conflict shows an error and does not kill the listener or silently change storage origin.
- Cache-only purge and the development file-watch refresh mechanism remain unchanged.

Replacing the app must preserve data; this needs a populated old→new upgrade test before public release.
A full workspace backup/restore and browser→desktop migration are not implemented. Do not promise them.
Users should export important work using available exports before a beta upgrade.

## Verification / QA

```sh
python3 -m unittest discover -s tests -p test_packaged_server.py
clang tests/test_release_feed.m launchers/NotlinearUpdates.m -I launchers -framework Cocoa -fobjc-arc -o /tmp/notlinear-release-feed-test
/tmp/notlinear-release-feed-test dist/release-v0.2.0/latest.json
node tests/test_download_page.mjs
```

For QA while another service owns 8765, the builder accepts a separate app identity and compile-time port:

```sh
python3 scripts/build_macos.py \
  --python-framework /Library/Frameworks/Python.framework/Versions/3.13 \
  --output dist/free-beta-qa/Notlinear.app --bundle-id local.notlinear.releaseqa3 --qa-port 18765 --build 3
```

QA uses separate WebKit identity and a `Notlinear Release QA` support folder. `--qa-port` is rejected
for the production bundle ID; release origins do not change. The QA identity cannot be staged for release.
An isolated native launch successfully served its frontend modules and file-watch HEAD requests;
computer-use inspection exposed only window controls, so rendered GUI behavior is not verified.
Local runtime/HTTP checks, manifest validation, page behavior cases, native compilation and image
checks do not replace the full AGENTS.md manual smoke, clean-Mac downloaded first launch,
file/folder permissions, or populated data-preserving upgrade tests.
