#!/usr/bin/env python3
"""Builds the Studiolo portable Windows app (a single Studiolo.exe, no installer).

Run after build_editions.py (or this script runs it first automatically):

    python3 tools/build_exe.py

What it does:
  1. Builds the Studiolo web edition into dist/studiolo/resources (same as
     build_editions.py).
  2. Packs that whole folder into one AES-256-GCM encrypted blob
     (brands/studiolo/app/app.bin) plus the matching key file
     (brands/studiolo/app/keydata.go). No readable HTML/CSS/JS ends up in
     the finished program.
  3. Cross-compiles brands/studiolo/app to a single Windows executable with
     the Studiolo icon and version info embedded.
  4. Zips just that one .exe (plus a short Read Me) as
     dist/Studiolo-portable.zip - nothing to install, nothing left over.

Needs: Go 1.22+ on PATH. No C compiler or Windows machine required.
"""
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'brands', 'studiolo', 'app')
RESOURCES = os.path.join(ROOT, 'dist', 'studiolo', 'resources')


def run(cmd, **kw):
    print('  $', ' '.join(cmd))
    subprocess.run(cmd, check=True, cwd=kw.pop('cwd', APP), **kw)


def main():
    print('1/4 building the Studiolo web edition...')
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    import build_editions
    for ed in __import__('json').loads(build_editions.read('brands/editions.json')):
        if ed['id'] == 'studiolo':
            build_editions.build(ed)

    print('2/4 packing it into one encrypted file (no readable source in the app)...')
    pack_dir = os.path.join(APP, 'pack')
    pack_bin = os.path.join(pack_dir, '_packbin')
    run(['go', 'build', '-o', pack_bin, '.'], cwd=pack_dir)
    run([pack_bin, RESOURCES,
         os.path.join(APP, 'app.bin'), os.path.join(APP, 'keydata.go')])
    os.remove(pack_bin)

    print('3/4 compiling Studiolo.exe for Windows...')
    env = dict(os.environ, GOOS='windows', GOARCH='amd64', CGO_ENABLED='0')
    exe = os.path.join(APP, 'Studiolo.exe')
    run(['go', 'build', '-ldflags=-s -w -H=windowsgui', '-trimpath', '-o', exe, '.'], env=env)

    print('4/4 packaging dist/Studiolo-portable.zip...')
    out_dir = os.path.join(ROOT, 'dist')
    os.makedirs(out_dir, exist_ok=True)
    archive = os.path.join(out_dir, 'Studiolo-portable.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        info = zipfile.ZipInfo.from_file(exe, 'Studiolo.exe')
        info.external_attr = 0o755 << 16
        with open(exe, 'rb') as f:
            z.writestr(info, f.read(), zipfile.ZIP_DEFLATED)
        readme = os.path.join(ROOT, 'brands', 'studiolo', 'Read Me (Windows app).txt')
        z.write(readme, 'Read Me.txt')
    size_mb = os.path.getsize(exe) / 1_000_000
    print('built Studiolo.exe (%.1f MB) -> %s' % (size_mb, os.path.relpath(archive, ROOT)))


if __name__ == '__main__':
    main()
