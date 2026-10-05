"""Builds a portable, self-contained copy of the homepage.

Run: python3 scripts/export.py   (after build_data.py and build_images.py)

Writes public/RADAR-Gallery-to-Archive.html: index.html with its stylesheets,
scripts, logo, data (home.json) and featured artwork inlined, so it opens
from disk on its own. The image assets themselves are left untouched.
Product and catalogue pages stay separate files; the export links to them
relative to its own folder, which is why it is written into public/.
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

from paths import ASSETS, DATA, EXPORT_HTML, PUBLIC, THUMBS

LOGO = 'radar-logo-updated.png'
SHOPIFY_CDN = 'https://cdn.shopify.com/'
# Asset links carry a ?v= cache-busting version; match with or without it.
STYLESHEET = re.compile(
    r'<link rel="stylesheet" href="(css/[a-z-]+\.css)(\?v=[^"]*)?">'
)
SCRIPT = re.compile(r'<script src="(js/[a-z/-]+\.js)(\?v=[^"]*)?"></script>')


class ExportError(Exception):
    """A file the export needs is missing or unsuitable."""


def data_url(path: Path, mime: str) -> str:
    """Returns a file's contents as a base64 data: URL.

    Args:
        path: The file.
        mime: Its MIME type, e.g. 'image/png'.
    """
    encoded = base64.b64encode(path.read_bytes()).decode()
    return f'data:{mime};base64,{encoded}'


def inline_stylesheets(html: str) -> str:
    """Replaces each stylesheet link with a <style> block, in order.

    Args:
        html: The page.

    Raises:
        ExportError: The page links no stylesheets.
    """
    html, count = STYLESHEET.subn(
        lambda match: f'<style>{(PUBLIC / match.group(1)).read_text()}</style>',
        html,
    )
    if not count:
        raise ExportError('no stylesheets found in index.html')
    return html


def inline_logo(html: str) -> str:
    """Replaces the logo's src with the image itself.

    Args:
        html: The page.
    """
    return html.replace(
        f'src="assets/{LOGO}"', f'src="{data_url(ASSETS / LOGO, "image/png")}"'
    )


def load_home_data() -> dict[str, Any]:
    """Returns data/home.json, which the homepage loads.

    Raises:
        ExportError: build_data.py hasn't been run.
    """
    home_path = DATA / 'home.json'
    if not home_path.exists():
        raise ExportError(
            'data/home.json missing: run python3 scripts/build_data.py'
        )
    data: dict[str, Any] = json.loads(home_path.read_text())
    return data


def artwork_urls(home: dict[str, Any]) -> dict[str, str]:
    """Inlines each featured piece's 640 px JPEG thumbnail, not the original.

    js/core/artwork.js's art() uses these when `assetUrls` is defined.
    Artwork that lives only on Shopify's CDN is linked at 640 px instead.

    Args:
        home: From load_home_data().

    Returns:
        Image name -> URL to use.

    Raises:
        ExportError: A thumbnail is missing (run build_images.py).
    """
    urls = {}
    for name in sorted({piece['image'] for piece in home['products']}):
        if name.startswith(SHOPIFY_CDN):
            urls[name] = f'{name}{"&" if "?" in name else "?"}width=640'
            continue
        thumbnail = THUMBS / f'{Path(name).stem}-640.jpg'
        if not thumbnail.exists():
            raise ExportError(
                f'{thumbnail.name} missing: run python3 scripts/build_images.py'
            )
        urls[name] = data_url(thumbnail, 'image/jpeg')
    return urls


def inline_scripts(html: str, embedded: str) -> str:
    """Replaces each script tag with its source, in order.

    The embedded data goes immediately before the first script, so it exists
    before any script runs.

    Args:
        html: The page.
        embedded: A <script> defining the data the scripts need.

    Raises:
        ExportError: The page has no scripts, or one contains '</script'.
    """
    inlined: list[str] = []

    def inline(match: re.Match[str]) -> str:
        path = match.group(1)
        source = (PUBLIC / path).read_text()
        if '</script' in source:
            raise ExportError(f'{path} would end the inline <script> early')
        inlined.append(path)
        prefix = embedded if len(inlined) == 1 else ''
        return f'{prefix}<script>{source}</script>'

    html = SCRIPT.sub(inline, html)
    if not inlined:
        raise ExportError('no scripts found in index.html')
    return html


def build_export() -> str:
    """Returns the self-contained homepage.

    Raises:
        ExportError: A file the export needs is missing.
    """
    html = inline_logo(inline_stylesheets((PUBLIC / 'index.html').read_text()))
    home = load_home_data()
    home_json = json.dumps(
        {'data/home.json': home}, ensure_ascii=False, separators=(',', ':')
    )
    urls = json.dumps(artwork_urls(home))
    embedded = (
        f'<script>window.radarInlineData={home_json};'
        f'window.assetUrls={urls};</script>\n'
    )
    return inline_scripts(html, embedded)


def main() -> None:
    """Writes the export and reports its size."""
    try:
        html = build_export()
    except ExportError as error:
        raise SystemExit(f'export: {error}') from error
    EXPORT_HTML.write_text(html)
    megabytes = EXPORT_HTML.stat().st_size / 1024 / 1024
    print(f'Exported {EXPORT_HTML.name} ({megabytes:.1f} MB)')


if __name__ == '__main__':
    main()
