"""Builds display-size thumbnails, leaving the supplied originals untouched.

Run: python3 scripts/build_images.py
(macOS; uses the built-in `sips`, so nothing needs installing)

For each assets/reference-NN.png it writes, into assets/thumbs/:
  reference-NN-320.avif / .jpg   cards and the contact panel (artwork is
                                 about 140-160 CSS px wide; 320 covers 2x)
  reference-NN-640.avif / .jpg   the product stage (artwork up to about
                                 300 CSS px wide)
AVIF is preferred by browsers that support it; JPEG is the fallback and is
what the portable export inlines. The full-size PNG is still used by the
art-detail lens, which needs the resolution and only loads when opened.

It also makes 160/640/1280 px versions of the product media images and video
posters listed in data/products.json, named after their path with / as --.
Thumbnails newer than their source are skipped, so re-running is cheap.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from paths import ASSETS, PRODUCTS_JSON, PUBLIC, THUMBS

REFERENCE_WIDTHS = (320, 640)
# Media strip previews (160), the stage and the art-detail lens (640, 1280).
MEDIA_WIDTHS = (160, 640, 1280)
# Output format -> sips quality, 0-100.
QUALITY = {'avif': '70', 'jpg': '82'}


@dataclass
class Counts:
    """How many thumbnails were written and skipped."""

    made: int = 0
    skipped: int = 0


def is_fresh(target: Path, source: Path) -> bool:
    """Whether a thumbnail exists and is newer than its source.

    Args:
        target: The thumbnail.
        source: The image it is made from.
    """
    return target.exists() and target.stat().st_mtime >= source.stat().st_mtime


def convert(source: Path, target: Path, resize: list[str]) -> None:
    """Writes one resized copy of an image with sips.

    Args:
        source: The original image.
        target: The thumbnail to write; its suffix picks the format.
        resize: The sips resize options, e.g. ['-Z', '320'].
    """
    ext = target.suffix[1:]
    sips_format = 'jpeg' if ext == 'jpg' else ext
    subprocess.run(
        [
            'sips',
            *resize,
            '-s',
            'format',
            sips_format,
            '-s',
            'formatOptions',
            QUALITY[ext],
            str(source),
            '--out',
            str(target),
        ],
        check=True,
        capture_output=True,
    )


def build_reference_thumbs(counts: Counts) -> None:
    """Makes the 320 and 640 px thumbnails of every reference-NN.png.

    Args:
        counts: Updated with what was written and skipped.
    """
    for source in sorted(ASSETS.glob('reference-*.png')):
        for width in REFERENCE_WIDTHS:
            for ext in QUALITY:
                target = THUMBS / f'{source.stem}-{width}.{ext}'
                if is_fresh(target, source):
                    counts.skipped += 1
                    continue
                # -Z fits the longest side within the width.
                convert(source, target, ['-Z', str(width)])
                counts.made += 1


def media_sources() -> list[str]:
    """Returns the media images and video posters in products.json.

    Returns:
        Paths relative to assets/, sorted.
    """
    sources = set()
    for piece in json.loads(PRODUCTS_JSON.read_text())['products']:
        for item in piece.get('media', []):
            if item.get('type') == 'image':
                sources.add(item['src'])
            if item.get('type') == 'video':
                sources.add(item['poster'])
    return sorted(sources)


def pixel_width(image: Path) -> int:
    """Returns an image's width in pixels, read with sips.

    Args:
        image: The image file.
    """
    output = subprocess.run(
        ['sips', '-g', 'pixelWidth', str(image)],
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    return int(output.split()[-1])


def build_media_thumbs(counts: Counts) -> None:
    """Makes the 160, 640 and 1280 px versions of every media image.

    Images are resized by width and never upscaled.

    Args:
        counts: Updated with what was written and skipped.
    """
    for relative in media_sources():
        source = ASSETS / relative
        if not source.exists():
            print(f'missing media file: assets/{relative}')
            continue
        native = pixel_width(source)
        stem = relative.rsplit('.', 1)[0].replace('/', '--')
        for width in MEDIA_WIDTHS:
            for ext in QUALITY:
                target = THUMBS / f'{stem}-{width}.{ext}'
                if is_fresh(target, source):
                    counts.skipped += 1
                    continue
                convert(
                    source, target, ['--resampleWidth', str(min(width, native))]
                )
                counts.made += 1


def main() -> None:
    """Brings every thumbnail up to date and reports the totals."""
    THUMBS.mkdir(exist_ok=True)
    counts = Counts()
    build_reference_thumbs(counts)
    build_media_thumbs(counts)
    total = sum(file.stat().st_size for file in THUMBS.iterdir()) / 1048576
    print(
        f'Thumbnails: {counts.made} written, {counts.skipped} up to date, '
        f'{total:.1f} MB in {THUMBS.relative_to(PUBLIC)}'
    )


if __name__ == '__main__':
    main()
