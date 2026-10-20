#!/usr/bin/env python3
"""Builds the Ring Breaker game into one self-contained HTML file: out/Ring-Breaker.html

    python3 tools/build_game.py

The file has everything inside it (rules, drawing, styles), needs no internet, and runs by
double-clicking it or opening it on a phone.
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'games', 'ring-breaker')


def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


def main():
    html = read('index.html')
    # Inline the scripts; the page still can't reach the internet (connect-src 'none').
    script = read('core.js') + '\n' + read('game.js')
    inline = '\n  <script>\n' + script.replace('</script', '<\\/script') + '\n  </script>'
    html = re.sub(r'\s*<script src="core\.js"></script>\s*<script src="game\.js"></script>', lambda m: inline, html)
    html = html.replace('script-src \'self\'', "script-src 'unsafe-inline'")
    out = os.path.join(ROOT, 'out')
    os.makedirs(out, exist_ok=True)
    dest = os.path.join(out, 'Ring-Breaker.html')
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(html)
    print('built', os.path.relpath(dest, ROOT), '(%d KB)' % (len(html.encode()) // 1024))


if __name__ == '__main__':
    main()
