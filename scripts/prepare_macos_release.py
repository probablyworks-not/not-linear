#!/usr/bin/env python3
"""Prepare versioned GitHub release assets; optionally upload a draft, never publish."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess

REPOSITORY = 'probablyworks-not/not-linear'


def prepare(app, dmg, output, tag, architecture):
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    version = info['CFBundleShortVersionString']
    build = int(info['CFBundleVersion'])
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or build < 1 or tag != f'v{version}':
        raise ValueError('Tag must match the numeric app version (vX.Y.Z); build must be positive')
    native_arches = subprocess.check_output(['lipo', '-archs', str(app / 'Contents/MacOS/Notlinear')], text=True).split()
    if native_arches != [architecture]:
        raise ValueError('DMG architecture must match the app binary')
    if info['CFBundleIdentifier'] != 'local.notlinear.app':
        raise ValueError('A QA app identity cannot be released')
    if not dmg.is_file() or dmg.suffix != '.dmg':
        raise ValueError('Provide a verified DMG')
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    subprocess.run(['hdiutil', 'verify', str(dmg)], check=True, stdout=subprocess.DEVNULL)
    output.mkdir(parents=True, exist_ok=False)
    filename = f'Notlinear-{version}-{architecture}.dmg'
    target = output / filename
    shutil.copyfile(dmg, target)
    hasher = hashlib.sha256()
    with target.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    feed = {'app': 'notlinear', 'version': version, 'build': build, 'notarized': False,
            'downloads': {architecture: {'url': f'https://github.com/{REPOSITORY}/releases/download/{tag}/{filename}',
                                       'sha256': digest}}}
    (output / 'latest.json').write_text(json.dumps(feed, indent=2) + '\n')
    (output / 'SHA256SUMS.txt').write_text(f'{digest}  {filename}\n')
    notes = f'''Notlinear {version} — macOS early beta

Download `{filename}`, open the DMG, and drag Notlinear to Applications.
Apple Silicon only for this release. Other Mac configurations have not been verified.

This app is ad-hoc signed and is **not notarized by Apple**. If macOS blocks it,
try opening it once, then use System Settings → Privacy & Security → Open Anyway
if you trust this download. Do not disable Gatekeeper globally.
Apple's instructions: https://support.apple.com/102445

Enter your own model-provider API key in Settings. Your chats and Notes are
stored locally; configured AI/research services receive relevant requests.
The app still loads some libraries/fonts from CDNs and needs internet access.
API keys currently use local browser storage; Keychain storage is not implemented.

To update: finish your current work, quit Notlinear, open the new DMG, and replace
the app in Applications. Do not clear website data or change the local address.
Keep a backup of important work; a complete in-app workspace backup is not yet available.
Only run one copy/local server at a time (port 8765).

Release review: native/provider smoke, data-preserving upgrade and clean-Mac
first-launch checks must be completed before publishing this draft.

Verify the download with `SHA256SUMS.txt`. Update notices use `latest.json`;
this release does not automatically install updates.
'''
    (output / 'release-notes.md').write_text(notes)
    return [target, output / 'latest.json', output / 'SHA256SUMS.txt']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--dmg', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--arch', choices=['arm64', 'x86_64'], default='arm64')
    parser.add_argument('--upload-draft', action='store_true')
    parser.add_argument('--target', help='Remote commit SHA/ref for a new draft; required with --upload-draft')
    args = parser.parse_args()
    if args.upload_draft and not args.target:
        parser.error('--upload-draft requires an explicit remote --target')
    files = prepare(args.app.resolve(), args.dmg.resolve(), args.output.resolve(), args.tag, args.arch)
    if args.upload_draft:
        subprocess.run(['gh', 'release', 'create', args.tag, '--repo', REPOSITORY,
                        '--draft', '--target', args.target, '--title', f'Notlinear {args.tag} — macOS beta',
                        '--notes-file', str(args.output / 'release-notes.md'), *map(str, files)], check=True)
    print(f'Release assets prepared at {args.output}; no public release was published.')


if __name__ == '__main__':
    main()
