#!/usr/bin/env python3
"""Build an isolated development .app from a python.org framework (stdlib only)."""
import argparse
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MACHO = {b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'}


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def macho(path):
    if path.is_symlink() or not path.is_file():
        return False
    with path.open('rb') as source:
        return source.read(4) in MACHO


def bundle_python(source, destination, arch):
    """Copy only the runtime: never installed packages, credentials, or user files."""
    version = source.name
    if not re.fullmatch(r'3\.\d+', version) or not (source / 'Python').is_file():
        raise ValueError('--python-framework must name a python.org Versions/3.x directory')
    destination.mkdir(parents=True)
    (destination / 'bin').mkdir()
    (destination / 'lib').mkdir()
    shutil.copy2(source / 'Python', destination / 'Python')
    # The framework's bin/python is a launcher for Python.app; bundle the actual interpreter.
    shutil.copy2(source / 'Resources/Python.app/Contents/MacOS/Python',
                 destination / 'bin' / f'python{version}')
    (destination / 'bin' / 'python3').symlink_to(f'python{version}')
    # Keep stdlib and its native extensions; omit Tk (unused by the server).
    shutil.copytree(source / 'lib' / f'python{version}', destination / 'lib' / f'python{version}',
                    ignore=shutil.ignore_patterns('site-packages', '__pycache__', 'test', 'tests',
                                                 'tkinter', '_tkinter*', '*.pyc'))
    for library in (source / 'lib').glob('*.dylib'):
        if library.is_symlink():
            continue
        shutil.copy2(library, destination / 'lib' / library.name)
    cert = source / 'etc/openssl/cert.pem'
    if not cert.is_file():
        raise ValueError('Python CA certificate bundle missing; run its Install Certificates.command first')
    (destination / 'etc/openssl').mkdir(parents=True)
    shutil.copyfile(cert, destination / 'etc/openssl/cert.pem')
    license_file = source / 'lib' / f'python{version}' / 'LICENSE.txt'
    if not license_file.is_file():
        raise ValueError('Python license missing from framework')
    shutil.copy2(license_file, destination / 'Python-LICENSE.txt')
    binaries = [p for p in destination.rglob('*') if macho(p)]
    for binary in binaries:
        architectures = subprocess.check_output(['lipo', '-archs', str(binary)], text=True).split()
        if arch not in architectures:
            raise ValueError(f'{binary.name} does not support {arch}')
        if len(architectures) > 1:
            thin = binary.with_name(binary.name + '.thin')
            run('lipo', binary, '-thin', arch, '-output', thin)
            os.replace(thin, binary)
        dependencies = subprocess.check_output(['otool', '-L', str(binary)], text=True)
        for line in dependencies.splitlines()[1:]:
            dep = line.strip().split(' (')[0]
            if dep.startswith(str(source) + '/'):
                target = destination / Path(dep).relative_to(source)
                if not target.is_file():
                    raise ValueError(f'Unbundled Python dependency: {dep}')
                replacement = '@loader_path/' + os.path.relpath(target, binary.parent)
                run('install_name_tool', '-change', dep, replacement, binary)
            elif dep.startswith('/') and not dep.startswith(('/usr/lib/', '/System/Library/')):
                raise ValueError(f'External dependency must be bundled: {dep}')
        if binary.name == 'Python' or binary.suffix == '.dylib':
            run('install_name_tool', '-id', '@loader_path/' + binary.name, binary)
        run('codesign', '--force', '--sign', '-', binary)
    # Do not trust a successful copy: actually run the relocated interpreter.
    run(destination / 'bin/python3', '-I', '-B', '-c',
        'import ssl, sqlite3, ctypes, http.server, subprocess, sys, pathlib; '
        'assert pathlib.Path(sys.prefix).resolve() == pathlib.Path(sys.argv[1]).resolve(); '
        'print("Bundled Python:", sys.prefix)', destination)


def create_dmg(app, version, arch):
    import tempfile
    dmg = app.parent / f'Notlinear-{version}-{arch}.dmg'
    if dmg.exists():
        raise FileExistsError(f'DMG already exists; choose a fresh version/output: {dmg}')
    with tempfile.TemporaryDirectory(prefix='notlinear-dmg-') as folder:
        staging = Path(folder)
        shutil.copytree(app, staging / app.name, symlinks=True)
        (staging / 'Applications').symlink_to('/Applications')
        run('hdiutil', 'create', '-volname', 'Notlinear', '-srcfolder', staging,
            '-format', 'UDZO', dmg)
    run('hdiutil', 'verify', dmg)
    print(f'Development DMG (not notarized): {dmg}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python-framework', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/Notlinear.app')
    parser.add_argument('--arch', choices=['arm64', 'x86_64'], default='arm64')
    parser.add_argument('--bundle-id', default='local.notlinear.app',
                        help='Keep stable for releases; use a distinct ID for isolated QA')
    parser.add_argument('--qa-port', type=int, help='Isolated QA only; requires a different bundle ID')
    parser.add_argument('--version', default='0.2.0')
    parser.add_argument('--build', type=int, default=2)
    parser.add_argument('--dmg', action='store_true', help='Create an unsigned development DMG')
    parser.add_argument('--dmg-only', action='store_true', help='Package an existing --output app')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('Build on macOS with Xcode Command Line Tools installed')
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version) or args.build < 1:
        parser.error('Use a numeric x.y.z version and a positive build number')
    app = args.output.expanduser().resolve()
    if args.qa_port and (args.bundle_id == 'local.notlinear.app' or not 1024 <= args.qa_port <= 65535):
        parser.error('--qa-port requires a separate QA bundle ID and a port from 1024 through 65535')
    if args.dmg_only:
        if not (app / 'Contents/Info.plist').is_file():
            parser.error('--dmg-only needs an existing app at --output')
        info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
        create_dmg(app, info['CFBundleShortVersionString'], args.arch)
        return
    if not args.python_framework:
        parser.error('--python-framework is required when building an app')
    if app.exists():
        parser.error(f'Output already exists; choose a fresh --output path: {app}')
    if app.suffix != '.app':
        parser.error('--output must end in .app')
    contents = app / 'Contents'
    resources = contents / 'Resources'
    (contents / 'MacOS').mkdir(parents=True)
    payload = resources / 'app'
    payload.mkdir(parents=True)
    # Explicit allowlist: never distribute the repo, personal feedback, logs or uploads.
    for directory in ['frontend', 'backend']:
        shutil.copytree(ROOT / directory, payload / directory,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store',
                                                     'debug-keys.html', 'index-design.html'))
    shutil.copy2(ROOT / 'CHANGELOG.md', payload / 'CHANGELOG.md')
    bundle_python(args.python_framework.expanduser().resolve(), resources / 'python', args.arch)
    info = plistlib.loads((ROOT / 'launchers/Notlinear.app/Contents/Info.plist').read_bytes())
    info.update(CFBundleIdentifier=args.bundle_id,
                CFBundleShortVersionString=args.version, CFBundleVersion=str(args.build),
                LSMinimumSystemVersion='11.0')
    (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
    qa_flags = [f'-DNOTLINEAR_PORT={args.qa_port}'] if args.qa_port else []
    run('clang', ROOT / 'launchers/NotlinearNative.m', ROOT / 'launchers/NotlinearUpdates.m',
        *qa_flags, '-o', contents / 'MacOS/Notlinear',
        '-arch', args.arch, '-mmacosx-version-min=11.0', '-framework', 'Cocoa',
        '-framework', 'WebKit', '-fobjc-arc')
    run('codesign', '--force', '--sign', '-', app)
    run('codesign', '--verify', '--deep', '--strict', app)
    if args.dmg:
        create_dmg(app, args.version, args.arch)
    print(f'Development app (not notarized): {app}')
    print('Free distribution: not Apple-notarized. Verify clean-Mac QA before publishing; see docs/MACOS_RELEASE.md.')


if __name__ == '__main__':
    main()
