# Release steps — Notlinear for Mac

This is the operator runbook for building, reviewing, publishing and updating Notlinear.
Use the free **ad-hoc-signed, unnotarized DMG** route. No paid Apple membership is assumed.
For runtime/data/security details, see [the Mac packaging reference](docs/MACOS_RELEASE.md).

## Updated review candidate — verified 2026-11-03

The user requested a fresh build for review, not public publication.

| Item | State |
| --- | --- |
| Candidate | **v0.2.1 / build 4**, arm64, ad-hoc signed and unnotarized |
| Review download | [GitHub draft release](https://github.com/probablyworks-not/not-linear/releases/tag/untagged-a7f846b6e3a674155801) |
| Exact build source | `83bc2ad4ef82ed4fb57f3e641a72c757a069fdfe` |
| Source review | [PR #2](https://github.com/probablyworks-not/not-linear/pull/2) |
| App/image output | `dist/mac-0.2.1-build4/` |
| Release assets | `dist/release-v0.2.1/` |
| DMG SHA-256 | `c08e174f3facba699097ad0502e817fd667a573f734387c11dceb0f9e072eff2` |

All three uploaded asset digests match local files. The image mounted read-only with the correct
version/build/identity, Applications shortcut and deep signature. All 27 payload files match source;
its runtime relocates and loads standard modules plus CA certificates. All eight integration tests
passed against the actual packaged backend using bundled Python; native feed/parser and four page
cases passed. The image was detached and temporary test servers shut down normally.

The 26 non-changelog application payload files match v0.2.0. This is a rebuild of current features
with the updated bundled changelog and release runbook in source, not a new feature implementation.
Both releases remain drafts. Full native GUI/provider, clean-Mac downloaded first launch,
populated upgrade and runtime dependency license review remain pending. Do not mark those passed.
Keep the older candidate available; do not overwrite its assets.

## Previous review candidate snapshot — checked 2026-11-03

| Item | State |
| --- | --- |
| Mac candidate | v0.2.0, app build 3, Apple Silicon (arm64) |
| Source review | [PR #2](https://github.com/probablyworks-not/not-linear/pull/2), open/draft |
| GitHub release | [v0.2.0 draft](https://github.com/probablyworks-not/not-linear/releases/tag/untagged-a53b1eba81446e0378dd), not public |
| Candidate source commit | `0bf5dc70268eda21adf7dadfccc7a820cfc5ea49` |
| Prepared assets | `dist/release-v0.2.0/` (local, ignored by Git) |
| Main website | [notlinear.lol](https://notlinear.lol/#download); download UI deployed on 2026-11-01 |
| Website repository | [probablyworks-not/notlinear-website](https://github.com/probablyworks-not/notlinear-website), Vercel deploys `main` |
| `www.notlinear.lol` | DNS NXDOMAIN on 2026-11-03; not a working alias yet |
| Outstanding checks | Full native/provider smoke, populated upgrade, clean-Mac downloaded first launch, bundled dependency license review |

The candidate's three assets are uploaded: `Notlinear-0.2.0-arm64.dmg`, `SHA256SUMS.txt`,
and `latest.json`. DMG SHA-256:

```text
d841921edbd982b8bf28425a8f813243b44b7158c742b6169524e76c6ea3d158
```

The draft points at the commit used for that candidate, not the latest documentation commit.
Do not silently retarget it or claim that it contains later application changes.
The website currently explains that the first public Mac release is being prepared.

## 1. Choose the source and version

- Review the source changes with the maintainer, as required by [AGENTS.md](AGENTS.md).
- Choose the exact approved source commit and ensure the working tree is clean before building.
- Increase both the app version (`X.Y.Z`) and integer build number for every new release.
  Native update checks compare **build numbers**, not just the visible version.
- The GitHub tag must be `vX.Y.Z`; it must match the app version.
- Keep `local.notlinear.app`, port 8765, database names, keys and schemas stable.
- Never reuse a published tag/asset URL for different binaries. Keep older release assets.
- Update CHANGELOG/FEATURES and task/run/change memory for the actual product change before building.
  The app bundles CHANGELOG.md, so changes after the build are not included in that DMG.

The following commands select the new **0.2.1 / build 4 review candidate**.
For a later release, choose higher version/build values and fresh output directories. Publication remains a separate step.
Run the shell blocks in the same Terminal session from the repository root, using a shell that stops on a failed command.

```sh
set -e
NL_RELEASE_REPO='probablyworks-not/not-linear'
NL_RELEASE_VERSION='0.2.1'
NL_RELEASE_BUILD='4'
NL_RELEASE_TAG="v${NL_RELEASE_VERSION}"
NL_BUILD_DIR="dist/mac-${NL_RELEASE_VERSION}-build${NL_RELEASE_BUILD}"
NL_STAGE_DIR="dist/release-${NL_RELEASE_TAG}"
NL_PYTHON_FRAMEWORK='/Library/Frameworks/Python.framework/Versions/3.13'
git status --short
NL_SOURCE_COMMIT="$(git rev-parse HEAD)"
```

Stop if the working tree is dirty or those output directories already exist. The scripts refuse
to overwrite an app/staging directory; use a fresh attempt directory rather than deleting a prior candidate.
For the existing v0.2.0 draft, do not rerun creation/upload commands: first review the uploaded candidate.

## 2. Build the application and DMG

Build on macOS with Xcode Command Line Tools and a python.org Python framework installed.
The end user does not need Python, Terminal or a repository checkout.

```sh
python3 scripts/build_macos.py \
  --python-framework "$NL_PYTHON_FRAMEWORK" \
  --output "$NL_BUILD_DIR/Notlinear.app" \
  --arch arm64 --version "$NL_RELEASE_VERSION" --build "$NL_RELEASE_BUILD" --dmg
```

If disk-image creation needs to be run separately after a successful app build:

```sh
python3 scripts/build_macos.py --output "$NL_BUILD_DIR/Notlinear.app" --dmg-only
```

The image is `$NL_BUILD_DIR/Notlinear-$NL_RELEASE_VERSION-arm64.dmg`.
The builder trims/relocates Python, checks imports/prefix and native dependencies, compiles the native
shell, and applies/verifies ad-hoc signatures. Ad-hoc signing is not Apple notarization.
No paid signing/notarization or automatic app installer is part of this release route.

## 3. Verify the candidate

Run the targeted checks; record results in `docs/project-notes/RUNS.md`.

```sh
python3 -m unittest discover -s tests -p test_packaged_server.py
clang tests/test_release_feed.m launchers/NotlinearUpdates.m \
  -I launchers -framework Cocoa -fobjc-arc -o /tmp/notlinear-release-feed-test
/tmp/notlinear-release-feed-test
node tests/test_download_page.mjs
codesign --verify --deep --strict "$NL_BUILD_DIR/Notlinear.app"
hdiutil verify "$NL_BUILD_DIR/Notlinear-$NL_RELEASE_VERSION-arm64.dmg"
```

Then perform and record the full [AGENTS.md manual smoke test](AGENTS.md#verification--run-before-claiming-any-task-is-done):

- [ ] Native app loads; send a real provider message and verify the configured fallback behavior.
- [ ] Highlight → branch → nested branch → close/reopen; switch chats and confirm content persists.
- [ ] Search-backed branch answer streams, status clears and retrieved results remain available.
- [ ] Attach files and a folder; verify chat and Notes exports/native save dialogs.
- [ ] Light-mode highlights remain readable; themes/keys/saved state survive reload and relaunch.
- [ ] Runtime log sync, live changelog rendering and development file-watch refresh still work.
- [ ] Open multiple Notes pages, switch between their tabs and reload without losing page identity.
- [ ] Quit/relaunch and a port conflict work without killing an unrelated listener or changing the origin.

Additional release checks:

- [ ] Test the downloaded/quarantined DMG on a clean supported Mac without Python/developer tools.
- [ ] Verify first-launch approval in Privacy & Security where allowed; native file/folder permissions work.
- [ ] Verify replacement of an older app preserves populated chat and Notes databases, settings and files.
- [ ] Verify Check for Updates… and a newer-build notice; Download Update opens the correct asset.
- [ ] Review bundled licenses/notices, absence of personal data/secrets, and accuracy of limitations.

Enter keys through the app; do not copy them into commands, screenshots, release notes or logs.
A passing build, HTTP request or feed parser does not establish a GUI/upgrade smoke pass.
A separate identity/port can isolate QA; instructions are in the Mac reference. Never release a QA bundle.

## 4. Stage release assets

```sh
python3 scripts/prepare_macos_release.py \
  --app "$NL_BUILD_DIR/Notlinear.app" \
  --dmg "$NL_BUILD_DIR/Notlinear-$NL_RELEASE_VERSION-arm64.dmg" \
  --output "$NL_STAGE_DIR" --tag "$NL_RELEASE_TAG"
/tmp/notlinear-release-feed-test "$NL_STAGE_DIR/latest.json"
```

Staging rechecks architecture, production identity, signatures and image integrity, then produces:

| File | Purpose |
| --- | --- |
| `Notlinear-X.Y.Z-arm64.dmg` | User download |
| `SHA256SUMS.txt` | Hash for manual verification |
| `latest.json` | Native updater's version/build/architecture/download metadata |
| `release-notes.md` | GitHub description and installation/update instructions |

Review/edit release notes before upload. Remove the pending-review paragraph only after those checks
actually pass; do not claim verification that did not happen. Retain these disclosed beta limitations:
Apple Silicon only, not notarized, some assets require internet/CDNs, keys use local browser storage,
and complete workspace backup/Keychain migration are not implemented.
The generated notes are a starting point, not a substitute for describing the actual changes.

## 5. Upload a draft with its exact source commit

Push the source commit through the normal review process before referring to it in a release.
Use a **full 40-character commit SHA**; GitHub rejected an abbreviated SHA during initial setup.
Upload the completed staged files, never the entire repo or app-data directories.

```sh
gh release create "$NL_RELEASE_TAG" --repo "$NL_RELEASE_REPO" \
  --draft --target "$NL_SOURCE_COMMIT" \
  --title "Notlinear $NL_RELEASE_VERSION — macOS early beta" \
  --notes-file "$NL_STAGE_DIR/release-notes.md" \
  "$NL_STAGE_DIR/Notlinear-$NL_RELEASE_VERSION-arm64.dmg" \
  "$NL_STAGE_DIR/latest.json" "$NL_STAGE_DIR/SHA256SUMS.txt"
gh release view "$NL_RELEASE_TAG" --repo "$NL_RELEASE_REPO" \
  --json tagName,isDraft,isPrerelease,targetCommitish,assets,url
```

An alternative for a new staging directory is `scripts/prepare_macos_release.py --upload-draft
--target FULL_SHA` with its normal build/image/output arguments. It creates a draft only.
Do not run both upload methods for the same tag. If a draft already exists, inspect it before deciding
how to update it; do not overwrite assets or retarget it without checking provenance and hashes.

## 6. Publish only the reviewed candidate

Source review, maintainer approval and the recorded smoke/upgrade checks are required before publication.
Confirm all three assets are uploaded and hashes match. The script does not publish automatically.
When approval and checks are complete, publish that candidate with an explicit action:

```sh
gh release edit "$NL_RELEASE_TAG" --repo "$NL_RELEASE_REPO" \
  --draft=false --prerelease=false --latest
```

Use a **regular release**, even if the notes call the product an early beta. GitHub's `latest` lookup
excludes drafts and prereleases. Publishing a complete draft makes its downloads/feed available together.
Publishing the Mac release does not merge the source PR or deploy website source changes.

## 7. Verify the public path

```sh
gh release view "$NL_RELEASE_TAG" --repo "$NL_RELEASE_REPO" \
  --json tagName,isDraft,isPrerelease,assets,url
NL_VERIFY_DIR="$(mktemp -d /tmp/notlinear-release-check.XXXXXX)"
gh release download "$NL_RELEASE_TAG" --repo "$NL_RELEASE_REPO" \
  --dir "$NL_VERIFY_DIR" --pattern '*.dmg' --pattern SHA256SUMS.txt --pattern latest.json
(cd "$NL_VERIFY_DIR" && shasum -a 256 -c SHA256SUMS.txt)
```

Also test in an unauthenticated browser:

- [ ] GitHub's latest release is public and downloads without a repository login.
- [ ] [The native feed](https://github.com/probablyworks-not/not-linear/releases/latest/download/latest.json)
  reports the correct version/build/hash and the asset URL downloads the same DMG.
- [ ] [The website](https://notlinear.lol/#download) shows the public version and every download CTA works.
- [ ] An installed previous build detects the update; offline/manual-failure cases remain understandable.

`gh release download` is an authenticated artifact check; it does not prove anonymous access.
The separate website discovers the latest arm64 asset through the public GitHub API. No website
redeploy is needed just to publish a new version. Website copy/layout changes are committed to
`probablyworks-not/notlinear-website`; its existing `main` → Vercel integration deploys them.
Do not deploy this app repo or the unused `release-site/` prototype over the real homepage.

## What users do for an update

The app checks on launch, every six hours, and through **Check for Updates…**. A higher published
build offers **Download Update / Later**. The browser downloads the DMG; users finish work, quit,
and replace Notlinear in Applications. There is no automatic installation/restart or cloud database.
The separate local data store must stay intact; preserve its identity and origin, and verify upgrades.
The existing developer **New update — refresh** button only reloads edited local files; it is not this updater.

## Domain and recovery notes

The root domain and `www` are separate DNS names. On 2026-11-03 the root resolved and `www` returned
NXDOMAIN. To enable `www`, attach it to the same Vercel project and add the exact DNS record Vercel
provides at the domain's DNS provider. Do not guess targets or change nameservers as a release step.
A missing `www` record does not require another Mac build.

If a release is bad, stop promoting it, keep older artifacts, and investigate. Changing the latest-release
pointer does not downgrade an app that is already installed. Prefer a tested corrective release with a
higher build number; verify data compatibility before any manual downgrade. Never clear user databases
or disable Gatekeeper globally as a recovery instruction.

After each release, update this snapshot, CHANGELOG/FEATURES as applicable, TASKS, RUNS and CHANGES.
Record an ADR for architecture changes. Leave unverified checks marked pending.
