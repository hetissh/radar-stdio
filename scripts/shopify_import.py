"""Imports the catalogue (products.json) into Shopify and checks it.

Run:
  python3 scripts/shopify_import.py                create or update
                                                   everything, then check
  python3 scripts/shopify_import.py --only 21,32   just these pieces
                                                   (collections and metafield
                                                   definitions always sync)
  python3 scripts/shopify_import.py --check        read the store back and
                                                   compare; writes nothing
  python3 scripts/shopify_import.py --reset-stock  also overwrite stock on
                                                   existing products with the
                                                   test levels

Re-runnable: products are matched on the metafield radar.id (the site's id)
and collections on their handle, so a run updates in place and never
duplicates. Stock is only set when a product is created (or with
--reset-stock), so a re-run doesn't overwrite real stock. The artwork image
is uploaded once, when a product has no media yet.

Mapping (docs/shopify-plan.md, "Data mapping"):
  collection         -> manual collection (handle = id), title, description;
                        radar.copy, radar.order
  name, description  -> product title, description; handle = name as a slug
  price, original    -> variant price; compare-at price when original > price
  sizes XS-XL        -> a "Size" option with 5 variants, SKU RADAR-<id>-<size>,
                        stock at the first location
  position           -> the collection's manual order
  id, collection, bearing, title, category, discipline, year, image, dark,
  status, media      -> radar.* metafields
  artwork image      -> product media (alt "Artwork: <title>")
Product media lists (photos, films) are kept as JSON in radar.media for now.
Everything is published to the Headless channel only.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from dataclasses import dataclass
from typing import Any

from paths import ASSETS, PRODUCTS_JSON
from shopify_api import (
    Admin,
    Json,
    headless_publications,
    metafields,
    price_to_int,
)

SIZES = ('XS', 'S', 'M', 'L', 'XL')
CURRENCY = 'INR'
VENDOR = 'RADAR STUDIO'
PRODUCT_TYPE = 'T-shirt'
TEST_STOCK = 10
# Test data: sizes that start sold out, to exercise the sold-out size rings.
SOLD_OUT = {
    '06': ('XS',),
    '13': ('XL',),
    '21': ('S',),
    '27': ('M', 'L'),
    '32': ('XL',),
}

# radar.* metafield definitions: (owner, key) -> (type, name). Readable by the
# Storefront API.
DEFINITIONS = {
    ('PRODUCT', 'id'): ('id', 'Site id'),
    ('PRODUCT', 'ring'): (
        'single_line_text_field',
        'Radar ring (primary collection)',
    ),
    ('PRODUCT', 'bearing'): ('number_integer', 'Radar bearing (degrees)'),
    ('PRODUCT', 'artwork_title'): ('single_line_text_field', 'Artwork title'),
    ('PRODUCT', 'category'): ('single_line_text_field', 'Artwork category'),
    ('PRODUCT', 'discipline'): ('single_line_text_field', 'Artwork discipline'),
    ('PRODUCT', 'year'): ('single_line_text_field', 'Artwork year'),
    ('PRODUCT', 'image'): (
        'single_line_text_field',
        'Artwork file (site assets)',
    ),
    ('PRODUCT', 'dark'): ('boolean', 'Washed black garment'),
    ('PRODUCT', 'status'): ('multi_line_text_field', 'Provenance note'),
    ('PRODUCT', 'media'): ('json', 'Product page media list'),
    ('COLLECTION', 'copy'): ('multi_line_text_field', 'Radar blurb'),
    ('COLLECTION', 'order'): ('number_integer', 'Radar order'),
}

Piece = dict[str, Any]
Collection = dict[str, Any]


@dataclass
class ImportContext:
    """What every product import needs."""

    admin: Admin
    location: str  # gid of the location stock is set at
    publication: str  # gid of the Headless channel
    reset_stock: bool


def slug(text: str) -> str:
    """Returns a URL handle: 'Signal 21 Tee' becomes 'signal-21-tee'.

    Args:
        text: A product name.
    """
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def product_metafields(piece: Piece) -> list[dict[str, str]]:
    """Returns a piece's radar.* metafields, leaving out empty ones.

    No `type`: the definitions supply it, and productSet only recognises the
    customId metafield without one.

    Args:
        piece: A piece from products.json.
    """
    values = {
        'id': piece['id'],
        'ring': piece['collection'],
        'bearing': str(piece['bearing']),
        'artwork_title': piece['title'],
        'category': piece['category'],
        'discipline': piece['discipline'],
        'year': piece['year'],
        'image': piece['image'],
        'dark': 'true' if piece['dark'] else 'false',
        'status': piece.get('status', ''),
        'media': json.dumps(piece['media']) if piece.get('media') else '',
    }
    return [
        {'namespace': 'radar', 'key': key, 'value': value}
        for key, value in values.items()
        if value != ''
    ]


def ensure_definitions(admin: Admin) -> None:
    """Creates any missing radar.* metafield definitions.

    Args:
        admin: The session.

    Raises:
        SystemExit: An existing definition has the wrong type.
    """
    for owner in ('PRODUCT', 'COLLECTION'):
        existing = {
            definition['key']: definition['type']['name']
            for definition in admin.graphql(
                DEFINITIONS_QUERY, {'owner': owner}
            )['metafieldDefinitions']['nodes']
        }
        for (definition_owner, key), (kind, name) in DEFINITIONS.items():
            if definition_owner != owner:
                continue
            if key in existing:
                if existing[key] != kind:
                    raise SystemExit(
                        f'metafield radar.{key} on {owner} is {existing[key]}, '
                        f'expected {kind}: fix it in the admin'
                    )
                continue
            definition: Json = {
                'namespace': 'radar',
                'key': key,
                'name': name,
                'ownerType': owner,
                'type': kind,
                'access': {'storefront': 'PUBLIC_READ'},
            }
            if kind == 'id':
                definition['capabilities'] = {'uniqueValues': {'enabled': True}}
            admin.graphql(DEFINITION_CREATE, {'d': definition})
            print(f'  defined radar.{key} ({owner.lower()})')


def headless_publication(admin: Admin) -> str:
    """Returns the Headless channel publication's id.

    Args:
        admin: The session.

    Raises:
        SystemExit: There isn't exactly one.
    """
    found = headless_publications(admin)
    if len(found) != 1:
        names = [publication['name'] for publication in found]
        raise SystemExit(f'expected one Headless publication, found {names}')
    publication: str = found[0]['id']
    return publication


def publish(admin: Admin, gid: str, publication: str) -> None:
    """Publishes a product or collection to a channel.

    Args:
        admin: The session.
        gid: The product or collection.
        publication: The channel's publication.
    """
    admin.graphql(PUBLISH, {'id': gid, 'p': publication})


def sync_collections(
    admin: Admin, collections: list[Collection], publication: str
) -> dict[str, str]:
    """Creates or updates each collection, with its radar order.

    Args:
        admin: The session.
        collections: From products.json, in ring order.
        publication: The Headless channel.

    Returns:
        Collection handle -> its gid.
    """
    ids = {}
    for order, collection in enumerate(collections):
        handle = collection['id']
        existing = admin.graphql(COLLECTION_BY_HANDLE, {'h': handle})[
            'collectionByIdentifier'
        ]
        copy_html = html.escape(collection['copy']).replace('\n', '<br>')
        fields = {
            'title': collection['title'],
            'handle': handle,
            'sortOrder': 'MANUAL',
            'descriptionHtml': f'<p>{copy_html}</p>',
            'metafields': [
                {
                    'namespace': 'radar',
                    'key': 'copy',
                    'type': 'multi_line_text_field',
                    'value': collection['copy'],
                },
                {
                    'namespace': 'radar',
                    'key': 'order',
                    'type': 'number_integer',
                    'value': str(order),
                },
            ],
        }
        if existing:
            admin.graphql(
                COLLECTION_UPDATE, {'c': {**fields, 'id': existing['id']}}
            )
            ids[handle] = existing['id']
        else:
            created = admin.graphql(COLLECTION_CREATE, {'c': fields})
            ids[handle] = created['collectionCreate']['collection']['id']
        publish(admin, ids[handle], publication)
        print(f'  collection {handle}: {"updated" if existing else "created"}')
    return ids


def variant_inputs(piece: Piece, stock_location: str | None) -> list[Json]:
    """Returns the five size variants for productSet.

    Args:
        piece: A piece from products.json.
        stock_location: Where to set test stock levels, or None to leave
            stock alone.
    """
    variants = []
    for size in SIZES:
        variant: Json = {
            'optionValues': [{'optionName': 'Size', 'name': size}],
            'price': str(piece['price']),
            'compareAtPrice': (
                str(piece['original'])
                if piece['original'] > piece['price']
                else None
            ),
            'inventoryPolicy': 'DENY',
            'inventoryItem': {
                'sku': f'RADAR-{piece["id"]}-{size}',
                'tracked': True,
            },
        }
        if stock_location:
            sold_out = size in SOLD_OUT.get(piece['id'], ())
            variant['inventoryQuantities'] = [
                {
                    'locationId': stock_location,
                    'name': 'available',
                    'quantity': 0 if sold_out else TEST_STOCK,
                }
            ]
        variants.append(variant)
    return variants


def sync_product(
    context: ImportContext, piece: Piece, collection_gid: str
) -> str:
    """Creates or updates one product, uploading its artwork if it has none.

    Args:
        context: The import's settings.
        piece: A piece from products.json.
        collection_gid: Its collection.

    Returns:
        The product's gid.
    """
    admin = context.admin
    identifier = {
        'customId': {'namespace': 'radar', 'key': 'id', 'value': piece['id']}
    }
    existing = admin.graphql(PRODUCT_BY_IDENTIFIER, {'i': identifier})[
        'productByIdentifier'
    ]
    # Stock is set on new products only, unless --reset-stock.
    set_stock = not existing or context.reset_stock
    stock_location = context.location if set_stock else None
    description = html.escape(piece.get('description', ''))
    product: Json = {
        'title': piece['name'],
        'handle': slug(piece['name']),
        'redirectNewHandle': True,
        'status': 'ACTIVE',
        'descriptionHtml': f'<p>{description}</p>',
        'vendor': VENDOR,
        'productType': PRODUCT_TYPE,
        'tags': [piece['category']],
        'collections': [collection_gid],
        'metafields': product_metafields(piece),
        'productOptions': [
            {'name': 'Size', 'values': [{'name': s} for s in SIZES]}
        ],
        'variants': variant_inputs(piece, stock_location),
    }
    if not existing or not existing['media']['nodes']:
        product['files'] = [
            {
                'originalSource': admin.upload(
                    ASSETS / piece['image'], 'IMAGE'
                ),
                'contentType': 'IMAGE',
                'alt': f'Artwork: {piece["title"]}',
            }
        ]
    gid: str = admin.graphql(PRODUCT_SET, {'i': product, 'id': identifier})[
        'productSet'
    ]['product']['id']
    publish(admin, gid, context.publication)
    artwork = ' + artwork' if 'files' in product else ''
    status = 'updated' if existing else 'created'
    print(f'  {piece["id"]} {piece["name"]}: {status}{artwork}')
    return gid


def reorder(admin: Admin, collection_gid: str, ordered_gids: list[str]) -> None:
    """Sets a collection's manual order and waits for it to apply.

    Args:
        admin: The session.
        collection_gid: The collection.
        ordered_gids: Its products, first to last.
    """
    moves = [
        {'id': gid, 'newPosition': str(position)}
        for position, gid in enumerate(ordered_gids)
    ]
    job = admin.graphql(REORDER, {'id': collection_gid, 'm': moves})[
        'collectionReorderProducts'
    ]['job']
    admin.wait_for_job(job)


def in_position_order(products: list[Piece], handle: str) -> list[Piece]:
    """Returns a collection's pieces in their curated order.

    Args:
        products: From products.json.
        handle: The collection.
    """
    return sorted(
        (piece for piece in products if piece['collection'] == handle),
        key=lambda piece: piece['position'],
    )


def store_pieces(admin: Admin) -> dict[str, tuple[Json, dict[str, str]]]:
    """Reads every product in the store that has a radar.id.

    Args:
        admin: The session.

    Returns:
        Site id -> (product node, its radar.* metafields).
    """
    store = {}
    for node in admin.pages(READ_PRODUCTS, ['products']):
        meta = metafields(node)
        if 'id' in meta:
            store[meta['id']] = (node, meta)
    return store


def read_back(node: Json, meta: dict[str, str]) -> Piece:
    """Returns a product's fields in the products.json shape, for comparing.

    Args:
        node: A product node from READ_PRODUCTS.
        meta: Its radar.* metafields.
    """
    variants = node['variants']['nodes']
    prices = {price_to_int(variant['price']) for variant in variants}
    compares = {
        price_to_int(variant['compareAtPrice'])
        if variant['compareAtPrice']
        else None
        for variant in variants
    }
    price: Any = prices.pop() if len(prices) == 1 else sorted(prices)
    compare: Any = (
        compares.pop() if len(compares) == 1 else sorted(compares, key=str)
    )
    description = re.sub(r'^<p>|</p>$', '', node['descriptionHtml'])
    return {
        'name': node['title'],
        'description': html.unescape(description),
        'collection': meta.get('ring'),
        'bearing': int(meta['bearing']) if 'bearing' in meta else None,
        'title': meta.get('artwork_title'),
        'category': meta.get('category'),
        'discipline': meta.get('discipline'),
        'year': meta.get('year'),
        'image': meta.get('image'),
        'dark': meta.get('dark') == 'true',
        'status': meta.get('status', ''),
        'media': json.loads(meta['media']) if 'media' in meta else None,
        'price': price,
        'original': compare if compare is not None else price,
    }


def published_to(node: Json) -> set[str]:
    """Returns the publications a product or collection is published to.

    Args:
        node: Selected with resourcePublicationsV2 { nodes { publication } }.
    """
    return {
        resource['publication']['id']
        for resource in node['resourcePublicationsV2']['nodes']
    }


def read_collection(admin: Admin, handle: str) -> tuple[Json | None, list[str]]:
    """Reads a collection and every product id in its manual order.

    Args:
        admin: The session.
        handle: The collection's handle.

    Returns:
        (the collection, or None if missing; its product gids in order).
    """
    gids: list[str] = []
    after = None
    info = None
    while True:
        data = admin.graphql(READ_COLLECTION, {'h': handle, 'after': after})[
            'collectionByIdentifier'
        ]
        if not data:
            break
        info = info or data
        gids += [product['id'] for product in data['products']['nodes']]
        if not data['products']['pageInfo']['hasNextPage']:
            break
        after = data['products']['pageInfo']['endCursor']
    return info, gids


@dataclass
class CheckScope:
    """What check() compares."""

    collections: list[Collection]
    products: list[Piece]
    publication: str  # gid of the Headless channel
    only: set[str] | None = None  # just these piece ids


class StoreCheck:
    """Compares the store with products.json, collecting problems."""

    def __init__(self, admin: Admin, scope: CheckScope) -> None:
        """Prepares a check.

        Args:
            admin: The session.
            scope: What to compare.
        """
        self.admin = admin
        self.scope = scope
        self.problems: list[str] = []

    def run(self) -> list[str]:
        """Checks the currency, every piece and every collection.

        Returns:
            A description of each problem; empty when everything round-trips.
        """
        currency = self.admin.graphql('{ shop { currencyCode } }')['shop'][
            'currencyCode'
        ]
        if currency != CURRENCY:
            self.problems.append(
                f'store currency is {currency}, expected {CURRENCY}'
            )
        store = store_pieces(self.admin)
        products, only = self.scope.products, self.scope.only
        if not only:
            known = {piece['id'] for piece in products}
            self.problems += [
                f'{piece_id}: in the store but not in products.json'
                for piece_id in sorted(set(store) - known)
            ]
        for piece in products:
            if only and piece['id'] not in only:
                continue
            if piece['id'] not in store:
                self.problems.append(f'{piece["id"]}: missing from the store')
                continue
            self.check_product(piece, store[piece['id']])
        site_id_of = {
            node['id']: piece_id for piece_id, (node, _) in store.items()
        }
        for order, collection in enumerate(self.scope.collections):
            self.check_collection(order, collection, site_id_of)
        return self.problems

    def check_product(
        self, piece: Piece, stored: tuple[Json, dict[str, str]]
    ) -> None:
        """Compares one piece with its product in the store.

        Args:
            piece: The piece in products.json.
            stored: (its product node, the product's radar.* metafields).
        """
        node, meta = stored
        piece_id = piece['id']
        got = read_back(node, meta)
        want = {
            key: piece.get(
                key, '' if key in ('description', 'status') else None
            )
            for key in got
        }
        problems = [
            f'{piece_id}: {key} is {got[key]!r}, expected {want[key]!r}'
            for key in got
            if got[key] != want[key]
        ]
        variants = {
            variant['selectedOptions'][0]['value']: variant
            for variant in node['variants']['nodes']
        }
        if node['handle'] != slug(piece['name']):
            problems.append(
                f'{piece_id}: handle is {node["handle"]}, '
                f'expected {slug(piece["name"])}'
            )
        if sorted(variants) != sorted(SIZES):
            problems.append(f'{piece_id}: sizes are {sorted(variants)}')
        problems += [
            f'{piece_id}: {size} SKU is {variant["sku"]}'
            for size, variant in variants.items()
            if variant['sku'] != f'RADAR-{piece_id}-{size}'
        ]
        handles = [c['handle'] for c in node['collections']['nodes']]
        if handles != [piece['collection']]:
            problems.append(f'{piece_id}: collections are {handles}')
        if node['status'] != 'ACTIVE':
            problems.append(f'{piece_id}: status {node["status"]}')
        if self.scope.publication not in published_to(node):
            problems.append(
                f'{piece_id}: not published to the Headless channel'
            )
        artwork_alt = f'Artwork: {piece["title"]}'
        has_artwork = any(
            media['mediaContentType'] == 'IMAGE' and media['alt'] == artwork_alt
            for media in node['media']['nodes']
        )
        if not has_artwork:
            problems.append(f'{piece_id}: artwork image missing')
        self.problems += problems

    def check_collection(
        self, order: int, collection: Collection, site_id_of: dict[str, str]
    ) -> None:
        """Compares one collection with the store.

        Args:
            order: Its radar order.
            collection: The collection in products.json.
            site_id_of: Product gid -> site id, for the order comparison.
        """
        handle = collection['id']
        info, gids = read_collection(self.admin, handle)
        if not info:
            self.problems.append(f'collection {handle}: missing from the store')
            return
        meta = metafields(info)
        if (
            info['title'] != collection['title']
            or meta.get('copy') != collection['copy']
            or meta.get('order') != str(order)
        ):
            self.problems.append(
                f'collection {handle}: title, blurb or order differs'
            )
        if info['sortOrder'] != 'MANUAL':
            self.problems.append(
                f'collection {handle}: sort order is {info["sortOrder"]}'
            )
        if self.scope.publication not in published_to(info):
            self.problems.append(
                f'collection {handle}: not published to the Headless channel'
            )
        got = [site_id_of.get(gid) for gid in gids]
        want = [p['id'] for p in in_position_order(self.scope.products, handle)]
        if not self.scope.only and got != want:
            self.problems.append(
                f'collection {handle}: order is {got}, expected {want}'
            )


def parse_args() -> argparse.Namespace:
    """Reads the command-line options."""
    parser = argparse.ArgumentParser(
        description='Import products.json into Shopify, then check it.'
    )
    parser.add_argument(
        '--only', help='comma-separated piece ids to import (e.g. 21,32)'
    )
    parser.add_argument(
        '--check', action='store_true', help='compare only; write nothing'
    )
    parser.add_argument(
        '--reset-stock',
        action='store_true',
        help='also set stock on existing products to the test levels',
    )
    return parser.parse_args()


def check_source(products: list[Piece], only: set[str] | None) -> None:
    """Checks the requested ids and the product handles before importing.

    Args:
        products: From products.json.
        only: Requested piece ids, if any.

    Raises:
        SystemExit: Unknown ids, or two products with the same handle.
    """
    known = {piece['id'] for piece in products}
    unknown = (only or set()) - known
    bad_stock = set(SOLD_OUT) - known
    handles = [slug(piece['name']) for piece in products]
    if unknown or bad_stock or len(handles) != len(set(handles)):
        raise SystemExit(
            f'unknown ids {sorted(unknown | bad_stock)} or duplicate product '
            'handles'
        )


@dataclass
class ImportRequest:
    """What to import, from the command line."""

    publication: str  # gid of the Headless channel
    only: set[str] | None  # just these piece ids
    reset_stock: bool


def import_catalogue(
    admin: Admin, source: Json, request: ImportRequest
) -> None:
    """Creates or updates definitions, collections, products and order.

    Args:
        admin: The session.
        source: products.json.
        request: What to import.

    Raises:
        SystemExit: The store's currency isn't CURRENCY.
    """
    collections, products = source['collections'], source['products']
    only = request.only
    currency = admin.graphql('{ shop { currencyCode } }')['shop'][
        'currencyCode'
    ]
    if currency != CURRENCY:
        raise SystemExit(
            f'Store currency is {currency}; set it to {CURRENCY} in Settings → '
            'General before importing.'
        )
    location = admin.graphql('{ locations(first: 1) { nodes { id } } }')[
        'locations'
    ]['nodes'][0]['id']
    context = ImportContext(
        admin, location, request.publication, request.reset_stock
    )
    print('Definitions')
    ensure_definitions(admin)
    print('Collections')
    collection_ids = sync_collections(admin, collections, context.publication)
    print('Products')
    gids = {
        piece['id']: sync_product(
            context, piece, collection_ids[piece['collection']]
        )
        for piece in products
        if not only or piece['id'] in only
    }
    if not only:
        print('Order')
        for collection in collections:
            pieces = in_position_order(products, collection['id'])
            reorder(
                admin,
                collection_ids[collection['id']],
                [gids[piece['id']] for piece in pieces],
            )


def main() -> None:
    """Imports (unless --check), then checks the store; exits 1 on problems."""
    args = parse_args()
    only = set(args.only.split(',')) if args.only else None
    source = json.loads(PRODUCTS_JSON.read_text())
    collections, products = source['collections'], source['products']
    check_source(products, only)
    admin = Admin()
    print(f'Store {admin.domain} (API {admin.version})')
    publication = headless_publication(admin)
    if not args.check:
        request = ImportRequest(publication, only, args.reset_stock)
        import_catalogue(admin, source, request)
    print('Check')
    scope = CheckScope(collections, products, publication, only)
    problems = StoreCheck(admin, scope).run()
    for problem in problems:
        print('  FAIL', problem)
    count = len(only) if only else len(products)
    outcome = (
        f'{len(problems)} problems' if problems else 'all fields round-trip'
    )
    print(f'  {outcome} ({count} pieces, {len(collections)} collections)')
    sys.exit(1 if problems else 0)


DEFINITIONS_QUERY = """query($owner: MetafieldOwnerType!) {
  metafieldDefinitions(first: 50, ownerType: $owner, namespace: "radar") {
    nodes { key type { name } } } }"""
DEFINITION_CREATE = """mutation($d: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $d) {
    createdDefinition { id } userErrors { field message } } }"""
PUBLISH = """mutation($id: ID!, $p: ID!) {
  publishablePublish(id: $id, input: [{publicationId: $p}]) {
    userErrors { field message } } }"""
COLLECTION_BY_HANDLE = """query($h: String!) {
  collectionByIdentifier(identifier: {handle: $h}) { id } }"""
COLLECTION_UPDATE = """mutation($c: CollectionUpdateInput!) {
  collectionUpdate(collection: $c) {
    collection { id } userErrors { field message } } }"""
COLLECTION_CREATE = """mutation($c: CollectionCreateInput!) {
  collectionCreate(collection: $c) {
    collection { id } userErrors { field message } } }"""
PRODUCT_BY_IDENTIFIER = """query($i: ProductIdentifierInput!) {
  productByIdentifier(identifier: $i) {
    id media(first: 1) { nodes { id } } } }"""
PRODUCT_SET = """mutation($i: ProductSetInput!, $id: ProductSetIdentifiers) {
  productSet(input: $i, identifier: $id, synchronous: true) {
    product { id } userErrors { field message } } }"""
REORDER = """mutation($id: ID!, $m: [MoveInput!]!) {
  collectionReorderProducts(id: $id, moves: $m) {
    job { id done } userErrors { field message } } }"""
READ_PRODUCTS = """query($after: String) { products(first: 100, after: $after) {
  pageInfo { hasNextPage endCursor }
  nodes { id title handle descriptionHtml status vendor productType
    metafields(first: 30, namespace: "radar") { nodes { key value } }
    variants(first: 20) { nodes { sku price compareAtPrice inventoryQuantity
      selectedOptions { name value } } }
    media(first: 10) { nodes { alt mediaContentType } }
    collections(first: 10) { nodes { handle } }
    resourcePublicationsV2(first: 10, onlyPublished: true) {
      nodes { publication { id } } } } } }"""
READ_COLLECTION = """query($h: String!, $after: String) {
  collectionByIdentifier(identifier: {handle: $h}) {
    title sortOrder
    metafields(first: 10, namespace: "radar") { nodes { key value } }
    resourcePublicationsV2(first: 10, onlyPublished: true) {
      nodes { publication { id } } }
    products(first: 250, after: $after, sortKey: COLLECTION_DEFAULT) {
      pageInfo { hasNextPage endCursor } nodes { id } } } }"""


if __name__ == '__main__':
    main()
