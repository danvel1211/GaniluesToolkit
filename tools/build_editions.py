#!/usr/bin/env python3
"""Builds each branded edition of the app into dist/<id>/ and dist/<id>.zip.

The source files are the Off the Clock Creative Suite edition. Every other edition
in brands/editions.json is produced by swapping in its name, tagline, logo and colours.

    python3 tools/build_editions.py
"""
import json
import os
import shutil
import urllib.parse
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_NAME = 'Off the Clock Creative Suite'
SOURCE_TAGLINE = 'Private creative and file tools that run in your browser.'
SOURCE_THEME_KEY = 'offtheclock-theme'
SKIP = {'.git', 'dist', 'tools', 'brands', '.gitignore'}
TEXT_EXT = ('.html', '.js', '.css', '.md', '.txt', '.json')


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def logo_markup(svg, size, wrapper):
    sized = svg.replace('<svg ', '<svg width="%d" height="%d" ' % (size, size), 1)
    sized = sized.replace(' xmlns="http://www.w3.org/2000/svg"', '')
    return wrapper % sized


def brand_text(text, ed, svg):
    text = text.replace(SOURCE_NAME, ed['name'])
    text = text.replace(SOURCE_TAGLINE, ed['tagline'])
    text = text.replace(SOURCE_THEME_KEY, ed['themeKey'])
    if svg:
        home = '<a class="logo" href="index.html" aria-label="%s home">%%s</a>' % ed['name']
        text = text.replace('<!-- brand-logo -->', logo_markup(svg, 28, home))
        text = text.replace('<!-- brand-logo-large -->', logo_markup(svg, 56, '<span class="logo" aria-hidden="true">%s</span>'))
        icon = svg.replace('fill="currentColor"', 'fill="#ea580c"')
        text = text.replace('<!-- brand-favicon -->', '<link rel="icon" href="data:image/svg+xml,%s">' % urllib.parse.quote(icon))
    return text


def build(ed):
    out = os.path.join(ROOT, 'dist', ed['id'])
    shutil.rmtree(out, ignore_errors=True)
    svg = read(ed['logo']).strip() if ed.get('logo') else None
    for folder, dirs, files in os.walk(ROOT):
        rel = os.path.relpath(folder, ROOT)
        dirs[:] = [d for d in dirs if not (rel == '.' and d in SKIP)]
        for name in files:
            if rel == '.' and name in SKIP:
                continue
            src = os.path.join(folder, name)
            dst = os.path.join(out, rel, name)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if name.endswith(TEXT_EXT) and 'vendor' not in rel and not name.startswith('LICENSE'):
                with open(src, encoding='utf-8') as f:
                    text = brand_text(f.read(), ed, svg)
                if ed.get('css') and rel == 'css' and name == 'styles.css':
                    text += '\n' + read(ed['css'])
                with open(dst, 'w', encoding='utf-8') as f:
                    f.write(text)
            else:
                shutil.copy2(src, dst)
    archive = out + '.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in os.walk(out):
            for name in files:
                full = os.path.join(folder, name)
                z.write(full, os.path.join(ed['name'], os.path.relpath(full, out)))
    print('built', ed['name'], '->', os.path.relpath(archive, ROOT))


if __name__ == '__main__':
    for edition in json.loads(read('brands/editions.json')):
        build(edition)
