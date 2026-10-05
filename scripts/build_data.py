"""Splits the catalogue source into the small files each page loads.

Run: python3 scripts/build_data.py   (after editing data/products.json)

Source of truth: data/products.json  {collections: [...], products: [...]}

Generated (do not edit by hand), all under public/data/:
  home.json               collections (with piece counts) and each
                          collection's first RAIL_LIMIT pieces: the homepage
  index.json              collections and a summary of every piece: the
                          catalogue
  collections/<id>.json   collections and every piece in one collection: a
                          product page's orbit and "More" row
  pieces/<id>.json        one piece in full, with description and status: a
                          product page
  inline.js               all of the above in one script, used only when a
                          page is opened from disk (file://), where browsers
                          block loading JSON files
Summaries leave out the long text (DETAIL_ONLY); only piece files carry it.

Every check runs first: a bad catalogue stops with a message and writes
nothing (Cloudflare then keeps serving the last good build).
"""

from __future__ import annotations

import json
from typing import Any

from paths import ASSETS, DATA, PRODUCTS_JSON, PUBLIC

# Keep in step with RAIL_LIMIT in public/js/home/home-collections.js.
RAIL_LIMIT = 12
# Fields only piece files carry.
DETAIL_ONLY = ('description', 'status', 'media')
MAX_MEDIA = 8
MAX_VIDEO_MB = 8
SHOPIFY_CDN = 'https://cdn.shopify.com/'

Piece = dict[str, Any]
Collection = dict[str, Any]


class CatalogueError(Exception):
    """The catalogue fails a check; the message says where."""


def require(condition: object, message: str) -> None:
    """Raises CatalogueError(message) unless the condition holds.

    Args:
        condition: Anything truthy passes.
        message: What is wrong, and where.

    Raises:
        CatalogueError: The condition is falsy.
    """
    if not condition:
        raise CatalogueError(message)


def check_catalogue(
    collections: list[Collection], products: list[Piece]
) -> None:
    """Checks ids, collections, positions, bearings, media and artwork.

    Args:
        collections: From products.json.
        products: From products.json.

    Raises:
        CatalogueError: The first problem found.
    """
    ids = [piece['id'] for piece in products]
    require(len(ids) == len(set(ids)), 'duplicate piece ids')
    for collection in collections:
        ring = [p for p in products if p['collection'] == collection['id']]
        for key in ('position', 'bearing'):
            values = [piece[key] for piece in ring]
            require(
                len(values) == len(set(values)),
                f'{collection["id"]}: duplicate {key}',
            )
    known = {collection['id'] for collection in collections}
    require(
        all(piece['collection'] in known for piece in products),
        'piece in an unknown collection',
    )
    for piece in products:
        check_media(piece)
        check_artwork(piece)


def check_media(piece: Piece) -> None:
    """Checks a piece's optional media list (product page only).

    Items are garment views, images and videos; paths are relative to assets/.

    Args:
        piece: A piece from products.json.

    Raises:
        CatalogueError: An item is incomplete or a file is missing or too big.
    """
    media = piece.get('media')
    if media is None:
        return
    where = f'piece {piece["id"]} media'
    require(1 <= len(media) <= MAX_MEDIA, f'{where}: 1-{MAX_MEDIA} items')
    for index, item in enumerate(media):
        check_media_item(item, f'{where}[{index}]')


def check_media_item(item: dict[str, Any], at: str) -> None:
    """Checks one media item and that its files exist.

    Args:
        item: A garment, image or video entry.
        at: Where it is, for messages.

    Raises:
        CatalogueError: The item is incomplete or a file is missing or too big.
    """
    require(item.get('label'), f'{at}: needs a short label')
    kind = item.get('type')
    if kind == 'garment':
        require(
            item.get('side') in ('front', 'back'),
            f'{at}: side must be front or back',
        )
        return
    require(kind in ('image', 'video'), f'{at}: unknown type {kind!r}')
    require(item.get('alt'), f'{at}: needs alt text')
    files = [item.get('src')]
    if kind == 'video':
        files.append(item.get('poster'))
        require(item.get('poster'), f'{at}: a video needs a poster image')
        require(
            item.get('mode') in ('loop', 'film'),
            f'{at}: mode must be loop (silent) or film',
        )
        require(
            str(item.get('src', '')).endswith('.mp4'),
            f'{at}: videos must be MP4 (H.264)',
        )
        if item['mode'] == 'film':
            require(
                item.get('captions'),
                f'{at}: a film needs a captions file (.vtt)',
            )
            files.append(item['captions'])
    for file in files:
        require(
            file and (ASSETS / file).exists(), f'{at}: assets/{file} not found'
        )
    if kind == 'video':
        megabytes = (ASSETS / item['src']).stat().st_size / 1048576
        require(
            megabytes <= MAX_VIDEO_MB,
            f'{at}: video is {megabytes:.1f} MB (limit {MAX_VIDEO_MB} MB)',
        )


def check_artwork(piece: Piece) -> None:
    """Checks a piece's artwork exists.

    It is a bundled file in assets/ (thumbnails come from build_images.py) or,
    for pieces made in the Shopify admin, a Shopify CDN URL (sync_shopify.py).

    Args:
        piece: A piece from products.json.

    Raises:
        CatalogueError: The artwork file is missing.
    """
    image = piece['image']
    require(
        image.startswith(SHOPIFY_CDN) or (ASSETS / image).is_file(),
        f'piece {piece["id"]}: artwork {image} not found in assets/',
    )


def summary(piece: Piece) -> Piece:
    """Returns a piece without the long text only piece files carry.

    Args:
        piece: A piece from products.json.
    """
    return {
        key: value for key, value in piece.items() if key not in DETAIL_ONLY
    }


def build_outputs(
    collections: list[Collection], products: list[Piece]
) -> dict[str, Any]:
    """Builds every generated file's content.

    Args:
        collections: From products.json, in ring order.
        products: From products.json.

    Returns:
        File path relative to public/ -> its JSON-serialisable content.
    """

    def ordered(collection_id: str) -> list[Piece]:
        pieces = [p for p in products if p['collection'] == collection_id]
        return sorted(pieces, key=lambda piece: piece['position'])

    meta = [{**c, 'count': len(ordered(c['id']))} for c in collections]
    outputs: dict[str, Any] = {
        'data/home.json': {
            'collections': meta,
            'products': [
                summary(piece)
                for collection in collections
                for piece in ordered(collection['id'])[:RAIL_LIMIT]
            ],
        },
        'data/index.json': {
            'collections': meta,
            'products': [
                summary(piece)
                for collection in collections
                for piece in ordered(collection['id'])
            ],
        },
    }
    for collection in collections:
        outputs[f'data/collections/{collection["id"]}.json'] = {
            'collections': meta,
            'products': [summary(piece) for piece in ordered(collection['id'])],
        }
    for piece in products:
        outputs[f'data/pieces/{piece["id"]}.json'] = piece
    return outputs


def compact_json(value: object) -> str:
    """Serialises without whitespace, keeping non-ASCII text as is.

    Args:
        value: Anything JSON-serialisable.
    """
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def write_outputs(outputs: dict[str, Any]) -> None:
    """Writes the files, removing ones for collections or pieces that are gone.

    Args:
        outputs: From build_outputs().
    """
    for folder in ('collections', 'pieces'):
        target = DATA / folder
        target.mkdir(exist_ok=True)
        for stale in target.glob('*.json'):
            if f'data/{folder}/{stale.name}' not in outputs:
                stale.unlink()
    for path, payload in outputs.items():
        (PUBLIC / path).write_text(compact_json(payload))
    (DATA / 'inline.js').write_text(
        f'window.radarInlineData={compact_json(outputs)};\n'
    )


def kilobytes(path: str) -> float:
    """Returns a generated file's size.

    Args:
        path: Relative to public/.
    """
    return (PUBLIC / path).stat().st_size / 1024


def main() -> None:
    """Checks the catalogue, then writes every generated file."""
    source = json.loads(PRODUCTS_JSON.read_text())
    collections, products = source['collections'], source['products']
    try:
        check_catalogue(collections, products)
    except CatalogueError as error:
        raise SystemExit(f'build_data: {error}') from error
    outputs = build_outputs(collections, products)
    write_outputs(outputs)
    first_piece = f'data/pieces/{products[0]["id"]}.json'
    print(
        f'{len(products)} pieces in {len(collections)} collections -> '
        f'{len(outputs)} files'
    )
    print(
        f'home.json {kilobytes("data/home.json"):.1f} KB · '
        f'index.json {kilobytes("data/index.json"):.1f} KB · '
        f'a piece {kilobytes(first_piece):.1f} KB · '
        f'inline.js {kilobytes("data/inline.js"):.1f} KB'
    )


if __name__ == '__main__':
    main()
