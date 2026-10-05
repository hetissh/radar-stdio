"""Build display-size thumbnails for every reference image, leaving the supplied originals untouched.

Run: python3 scripts/build_images.py   (macOS; uses the built-in `sips`, no installs needed)

For each assets/reference-NN.png it writes, into assets/thumbs/:
  reference-NN-320.avif / .jpg   cards, contact panel (artwork is ~140-160 CSS px wide; 320 covers 2x screens)
  reference-NN-640.avif / .jpg   product stage (artwork up to ~300 CSS px wide)
AVIF is preferred by browsers that support it; JPEG is the fallback and is what the portable export inlines.
The full-size PNG is still used for the art-detail lens, which needs the extra resolution, and only loads when it is opened.
It also makes 160/640/1280px versions of product media images and video posters listed in data/products.json.
Thumbnails newer than their source are skipped, so re-running is cheap.
"""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent / 'public'  # the published site
source_dir = root / 'assets'
out_dir = source_dir / 'thumbs'
out_dir.mkdir(exist_ok=True)
WIDTHS = (320, 640)
FORMATS = {'avif': '70', 'jpg': '82'}  # sips quality, 0-100

made = skipped = 0
for source in sorted(source_dir.glob('reference-*.png')):
    for width in WIDTHS:
        for ext, quality in FORMATS.items():
            target = out_dir / f'{source.stem}-{width}.{ext}'
            if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
                skipped += 1
                continue
            subprocess.run(['sips', '-Z', str(width), '-s', 'format', 'jpeg' if ext == 'jpg' else ext,
                            '-s', 'formatOptions', quality, str(source), '--out', str(target)],
                           check=True, capture_output=True)
            made += 1

# Product media (data/products.json): images and video posters, resized by width (never upscaled) to
# 160 (media strip previews), 640 and 1280 (stage and art-detail lens). Named after their path with / as --.
import json
MEDIA_WIDTHS = (160, 640, 1280)
media_sources = set()
for piece in json.loads((root / 'data' / 'products.json').read_text())['products']:
    for item in piece.get('media', []):
        if item.get('type') == 'image':
            media_sources.add(item['src'])
        if item.get('type') == 'video':
            media_sources.add(item['poster'])
for relative in sorted(media_sources):
    source = source_dir / relative
    if not source.exists():
        print(f'missing media file: assets/{relative}')
        continue
    native = int(subprocess.run(['sips', '-g', 'pixelWidth', str(source)], capture_output=True, text=True).stdout.split()[-1])
    stem = relative.rsplit('.', 1)[0].replace('/', '--')
    for width in MEDIA_WIDTHS:
        for ext, quality in FORMATS.items():
            target = out_dir / f'{stem}-{width}.{ext}'
            if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
                skipped += 1
                continue
            subprocess.run(['sips', '--resampleWidth', str(min(width, native)), '-s', 'format', 'jpeg' if ext == 'jpg' else ext,
                            '-s', 'formatOptions', quality, str(source), '--out', str(target)], check=True, capture_output=True)
            made += 1

total = sum(f.stat().st_size for f in out_dir.iterdir()) / 1048576
print(f'Thumbnails: {made} written, {skipped} up to date, {total:.1f} MB in {out_dir.relative_to(root)}')
