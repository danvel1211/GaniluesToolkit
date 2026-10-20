#!/usr/bin/env python3
"""Builds each branded edition of the app into dist/<id>/ and dist/<id>.zip.

The source files are the Off the Clock Creative Suite edition. Every other edition
in brands/editions.json is produced by swapping in its name, tagline, logo and colours.

    python3 tools/build_editions.py
"""
import base64
import json
import os
import re
import shutil
import subprocess
import urllib.parse
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_NAME = 'Off the Clock Creative Suite'
SOURCE_TAGLINE = 'Private creative and file tools that run in your browser.'
SOURCE_THEME_KEY = 'offtheclock-theme'
SKIP = {'.git', 'dist', 'out', 'games', 'tools', 'brands', '.gitignore'}
TEXT_EXT = ('.html', '.js', '.css', '.md', '.txt', '.json')


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def logo_markup(svg, size, wrapper):
    sized = svg.replace('<svg ', '<svg width="%d" height="%d" ' % (size, size), 1)
    sized = sized.replace(' xmlns="http://www.w3.org/2000/svg"', '')
    return wrapper % sized


CSP_CONNECT = "connect-src 'self' data: blob:"


def brand_text(text, ed, svg):
    if activation_url(ed):
        text = text.replace(CSP_CONNECT, CSP_CONNECT + ' https://script.google.com https://script.googleusercontent.com')
    text = text.replace(SOURCE_NAME, ed['name'])
    text = text.replace(SOURCE_TAGLINE, ed['tagline'])
    text = text.replace(SOURCE_THEME_KEY, ed['themeKey'])
    if svg:
        home = '<a class="logo" href="index.html" aria-label="%s home">%%s</a>' % ed['name']
        text = text.replace('<!-- brand-logo -->', logo_markup(svg, 28, home))
        text = text.replace('<!-- brand-logo-large -->', logo_markup(svg, 56, '<span class="logo" aria-hidden="true">%s</span>'))
        if ed.get('favicon'):
            text = text.replace('<!-- brand-favicon -->', '<link rel="icon" href="%s">' % ed['favicon'])
        else:
            icon = svg.replace('fill="currentColor"', 'fill="#ea580c"')
            text = text.replace('<!-- brand-favicon -->', '<link rel="icon" href="data:image/svg+xml,%s">' % urllib.parse.quote(icon))
    if ed.get('headHtml'):
        text = text.replace('<!-- brand-head -->', ed['headHtml'])
    for old, new in ed.get('rename', {}).items():
        text = text.replace(old, new)
    for link in ed.get('navLinks', []):
        text = text.replace('<!-- brand-nav -->', '<a href="%s">%s</a>\n          <!-- brand-nav -->' % (link['href'], link['label']))
        text = text.replace('<!-- brand-home-link -->', ' <a class="home-link" href="%s">%s</a><!-- brand-home-link -->' % (link['href'], link['homeLabel']))
    return text


def activation_url(ed):
    """The private activation address, if one is set up (brands/studiolo/activation.json, git-ignored)."""
    if not ed.get('activation'):
        return ''
    path = os.path.join(ROOT, ed['activation'])
    if not os.path.exists(path):
        return ''
    url = json.loads(read(ed['activation'])).get('url', '').strip()
    if url and not url.startswith('https://script.google.com/macros/s/'):
        raise SystemExit('activation url must be a Google Apps Script web app address (https://script.google.com/macros/s/...)')
    return url


def license_data_js(ed=None):
    """The licence fingerprints as one opaque block: no labels, no readable list."""
    text = read('brands/studiolo/license-codes.js')
    batches = json.loads(re.search(r'batches: (\[.*\])\s*\};', text, re.S).group(1))
    compact = [{'i': b['id'], 's': b['salt'],
                'h': base64.b64encode(b''.join(bytes.fromhex(h) for h in b['hashes'])).decode()} for b in batches]
    payload = {'b': compact}
    url = activation_url(ed) if ed else ''
    if url:  # stored reversed and base64-encoded so it isn't a readable address in the bundle
        payload['a'] = base64.b64encode(url[::-1].encode()).decode()
    return 'window.STUDIOLO_LICENSE_DATA=' + json.dumps(payload, separators=(',', ':')) + ';'


def minify(code):
    """Compresses with terser when available (npx); otherwise only strips comments."""
    try:
        result = subprocess.run(['npx', '--yes', 'terser@5.31.0', '--compress', '--mangle', '--comments', 'false'],
                                input=code, capture_output=True, text=True, timeout=300)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout
        print('  terser failed, falling back:', result.stderr.strip()[:200])
    except (OSError, subprocess.TimeoutExpired) as err:
        print('  terser unavailable (%s); comments stripped only' % err)
    code = re.sub(r'/\*[\s\S]*?\*/', '', code)
    return re.sub(r'^\s*//.*$', '', code, flags=re.M)


def write_bundle(ed, out):
    parts = []
    for part in ed['bundle']['parts']:
        parts.append(license_data_js(ed) if part == '@license-data' else read(part))
    code = '\n;\n'.join(parts)
    for old, new in ed.get('rename', {}).items():
        code = code.replace(old, new)
    dst = os.path.join(out, ed['bundle']['output'])
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(minify(code))


def build(ed):
    package_root = os.path.join(ROOT, 'dist', ed['id'])
    shutil.rmtree(package_root, ignore_errors=True)
    # A packaged edition looks like installed software: launchers at the top, the app in a subfolder.
    package = ed.get('package')
    out = os.path.join(package_root, package['folder']) if package else package_root
    svg = read(ed['logo']).strip() if ed.get('logo') else None
    for folder, dirs, files in os.walk(ROOT):
        rel = os.path.relpath(folder, ROOT)
        dirs[:] = [d for d in dirs if not (rel == '.' and d in SKIP)]
        for name in files:
            if rel == '.' and (name in SKIP or name in ed.get('exclude', [])):
                continue
            src = os.path.join(folder, name)
            dst = os.path.join(out, rel, name)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if name.endswith(TEXT_EXT) and 'vendor' not in rel and not name.startswith('LICENSE'):
                with open(src, encoding='utf-8') as f:
                    text = brand_text(f.read(), ed, svg)
                if ed.get('css') and rel == 'css' and name == 'styles.css':
                    css = ed['css'] if isinstance(ed['css'], list) else [ed['css']]
                    for path in css:
                        text += '\n' + brand_text(read(path), ed, svg)
                with open(dst, 'w', encoding='utf-8') as f:
                    f.write(text)
            else:
                shutil.copy2(src, dst)
    # Pages and assets that only this edition has (e.g. Studiolo's About page).
    for dst_rel, src_rel in ed.get('extraFiles', {}).items():
        dst = os.path.join(out, dst_rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if dst_rel.endswith(TEXT_EXT):
            with open(dst, 'w', encoding='utf-8') as f:
                f.write(brand_text(read(src_rel), ed, svg))
        else:
            shutil.copy2(os.path.join(ROOT, src_rel), dst)
    if ed.get('bundle'):
        write_bundle(ed, out)
    if package:
        for dst_rel, src_rel in package.get('rootFiles', {}).items():
            shutil.copy2(os.path.join(ROOT, src_rel), os.path.join(package_root, dst_rel))
    archive = package_root + '.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in os.walk(package_root):
            for name in files:
                full = os.path.join(folder, name)
                info = zipfile.ZipInfo.from_file(full, os.path.join(ed['name'], os.path.relpath(full, package_root)))
                if name.endswith('.exe'):
                    info.external_attr = 0o755 << 16
                with open(full, 'rb') as f:
                    z.writestr(info, f.read(), zipfile.ZIP_DEFLATED)
    print('built', ed['name'], '->', os.path.relpath(archive, ROOT))


if __name__ == '__main__':
    for edition in json.loads(read('brands/editions.json')):
        build(edition)
