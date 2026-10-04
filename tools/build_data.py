"""Split the catalogue source into the small files each page loads.

Run: python3 tools/build_data.py   (after editing data/products.json)

Source of truth: data/products.json  { collections: [...], products: [...] }
Generated (do not edit by hand):
  data/home.json                 collections (+ piece counts) and each collection's first RAIL_LIMIT pieces: the homepage
  data/index.json                collections and a summary of every piece: the catalogue
  data/collections/<id>.json     collections and every piece in one collection: a product page's orbit and "More" row
  data/pieces/<id>.json          one piece in full, with description and status: a product page
  data/inline.js                 all of the above in one script, used only when a page is opened from disk (file://),
                                 where browsers block loading JSON files
Summaries leave out the long text (description, status); only piece files carry it.
"""
from pathlib import Path
import json

RAIL_LIMIT = 12  # keep in step with RAIL_LIMIT in index.html
DETAIL_ONLY = ('description', 'status', 'media')
MAX_MEDIA = 8
MAX_VIDEO_MB = 8

root = Path(__file__).resolve().parent.parent / 'site'  # the published site folder
data = root / 'data'
source = json.loads((data / 'products.json').read_text())
collections, products = source['collections'], source['products']

# Checks: unique ids, known collections, and unique positions and bearings within each collection.
ids = [p['id'] for p in products]
assert len(ids) == len(set(ids)), 'duplicate piece ids'
known = {c['id'] for c in collections}
for c in collections:
    ring = [p for p in products if p['collection'] == c['id']]
    for key in ('position', 'bearing'):
        values = [p[key] for p in ring]
        assert len(values) == len(set(values)), f'{c["id"]}: duplicate {key}'
assert all(p['collection'] in known for p in products), 'piece in an unknown collection'

# Media (optional, product page only): garment views, images and videos. Paths are relative to assets/.
def check_media(p):
    media = p.get('media')
    if media is None:
        return
    where = f'piece {p["id"]} media'
    assert 1 <= len(media) <= MAX_MEDIA, f'{where}: 1-{MAX_MEDIA} items'
    for i, m in enumerate(media):
        at = f'{where}[{i}]'
        assert m.get('label'), f'{at}: needs a short label'
        kind = m.get('type')
        if kind == 'garment':
            assert m.get('side') in ('front', 'back'), f'{at}: side must be front or back'
            continue
        assert kind in ('image', 'video'), f'{at}: unknown type {kind!r}'
        assert m.get('alt'), f'{at}: needs alt text'
        files = [m.get('src')] + ([m.get('poster')] if kind == 'video' else [])
        if kind == 'video':
            assert m.get('poster'), f'{at}: a video needs a poster image'
            assert m.get('mode') in ('loop', 'film'), f'{at}: mode must be loop (silent) or film'
            assert str(m.get('src', '')).endswith('.mp4'), f'{at}: videos must be MP4 (H.264)'
            if m['mode'] == 'film':
                assert m.get('captions'), f'{at}: a film needs a captions file (.vtt)'
                files.append(m['captions'])
        for f in files:
            assert f and (root / 'assets' / f).exists(), f'{at}: assets/{f} not found'
        if kind == 'video':
            mb = (root / 'assets' / m['src']).stat().st_size / 1048576
            assert mb <= MAX_VIDEO_MB, f'{at}: video is {mb:.1f} MB (limit {MAX_VIDEO_MB} MB)'
for p in products:
    check_media(p)
    # Artwork: a bundled file in assets/ (thumbnails from build_images.py) or, for pieces made in the Shopify admin,
    # a Shopify CDN URL (see sync_shopify.py).
    assert p['image'].startswith('https://cdn.shopify.com/') or (root / 'assets' / p['image']).is_file(), \
        f'piece {p["id"]}: artwork {p["image"]} not found in assets/'

def summary(p):
    return {k: v for k, v in p.items() if k not in DETAIL_ONLY}

def ordered(collection_id):
    return sorted((p for p in products if p['collection'] == collection_id), key=lambda p: p['position'])

meta = [{**c, 'count': len(ordered(c['id']))} for c in collections]
outputs = {
    'data/home.json': {'collections': meta, 'products': [summary(p) for c in collections for p in ordered(c['id'])[:RAIL_LIMIT]]},
    'data/index.json': {'collections': meta, 'products': [summary(p) for c in collections for p in ordered(c['id'])]},
}
for c in collections:
    outputs[f'data/collections/{c["id"]}.json'] = {'collections': meta, 'products': [summary(p) for p in ordered(c['id'])]}
for p in products:
    outputs[f'data/pieces/{p["id"]}.json'] = p

for folder in ('collections', 'pieces'):
    target = data / folder
    target.mkdir(exist_ok=True)
    for stale in target.glob('*.json'):  # remove files for collections or pieces that no longer exist
        if f'data/{folder}/{stale.name}' not in outputs:
            stale.unlink()
for path, payload in outputs.items():
    (root / path).write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
(data / 'inline.js').write_text('window.radarInlineData=' + json.dumps(outputs, ensure_ascii=False, separators=(',', ':')) + ';\n')

size = lambda path: (root / path).stat().st_size / 1024
print(f'{len(products)} pieces in {len(collections)} collections -> {len(outputs)} files')
print(f'home.json {size("data/home.json"):.1f} KB · index.json {size("data/index.json"):.1f} KB · '
      f'a piece {size(f"data/pieces/{products[0]["id"]}.json"):.1f} KB · inline.js {size("data/inline.js"):.1f} KB')
