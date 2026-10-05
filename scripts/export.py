"""Build a portable, self-contained HTML mockup without altering image assets."""
from pathlib import Path
import base64
import json
import re

root = Path(__file__).resolve().parent.parent / 'public'  # the published site
html = (root / 'index.html').read_text()
# Asset links carry a ?v= cache-busting version; match with or without it.
for sheet in ('css/shared.css', 'css/collections.css'):
    html, found = re.subn(r'<link rel="stylesheet" href="' + re.escape(sheet) + r'(\?v=[^"]*)?">', lambda m, s=sheet: '<style>' + (root / s).read_text() + '</style>', html)
    assert found == 1, sheet
# Inline every script the homepage loads (shared.js, radar.js, the home-*.js modules), keeping their order.
scripts = []


def inline_script(match):
    scripts.append(match.group(1))
    source = (root / match.group(1)).read_text()
    assert '</script' not in source, match.group(1) + ' would end the inline <script> early'
    return '<script>' + source + '</script>'


html = re.sub(r'<script src="(js/[a-z/-]+\.js)(\?v=[^"]*)?"></script>', inline_script, html)
assert scripts and scripts[0] == 'js/core/shared.js', 'shared.js must be the first script: ' + str(scripts)
# Product pages are separate files; the portable homepage links to them relative to this folder.
logo = 'radar-logo-updated.png'
logo_url = 'data:image/png;base64,' + base64.b64encode((root / 'assets' / logo).read_bytes()).decode()
html = html.replace('src="assets/' + logo + '"', 'src="' + logo_url + '"')
# Data: the homepage loads data/home.json (build_data.py); embed it so the file works on its own.
home_path = root / 'data' / 'home.json'
assert home_path.exists(), 'data/home.json missing: run python3 scripts/build_data.py'
home = json.loads(home_path.read_text())
# Artwork: inline the 640px JPEG thumbnail of each featured image (build_images.py), not the full-size original.
# shared.js's art() switches to these when `assetUrls` is defined.
urls = {}
for name in sorted({p['image'] for p in home['products']}):
    if name.startswith('https://cdn.shopify.com/'):  # artwork only on Shopify's CDN: link the 640px version
        urls[name] = name + ('&' if '?' in name else '?') + 'width=640'
        continue
    thumbnail = root / 'assets' / 'thumbs' / (Path(name).stem + '-640.jpg')
    assert thumbnail.exists(), f'{thumbnail.name} missing: run python3 scripts/build_images.py'
    urls[name] = 'data:image/jpeg;base64,' + base64.b64encode(thumbnail.read_bytes()).decode()
embedded = ('<script>window.radarInlineData=' + json.dumps({'data/home.json': home}, ensure_ascii=False, separators=(',', ':'))
            + ';window.assetUrls=' + json.dumps(urls) + ';</script>\n')
html, found = re.subn(r'(<script>// Shared by every RADAR page)', lambda m: embedded + m.group(1), html)
assert found == 1, 'shared.js inline marker'
output = root / 'RADAR-Gallery-to-Archive.html'
output.write_text(html)
print(f'Exported {output.name} ({output.stat().st_size / 1024 / 1024:.1f} MB)')
