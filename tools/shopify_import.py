"""Import the catalogue (site/data/products.json) into the Shopify store, then check it round-trips.

Run:
  python3 tools/shopify_import.py              create or update everything, then run the check
  python3 tools/shopify_import.py --only 21,32 just these pieces (collections and definitions are always synced)
  python3 tools/shopify_import.py --check      read the store back and compare with products.json; writes nothing
  python3 tools/shopify_import.py --reset-stock  also overwrite stock on existing products with the test levels

Re-runnable: products are matched on the metafield radar.id (the site's id), collections on their handle, so a run
updates in place and never duplicates. Stock is only set when a product is created (or with --reset-stock), so a
re-run doesn't overwrite real stock. The artwork image is uploaded once, when a product has no media yet.

Mapping (docs/shopify-plan.md, "Data mapping"):
  collection            -> manual collection (handle = id), title, description; radar.copy, radar.order
  name, description     -> product title, description;  handle = name as a slug
  price, original       -> variant price, compare-at price (only when original > price)
  sizes XS-XL           -> "Size" option, 5 variants, SKU RADAR-<id>-<size>, stock at the first location
  position              -> the collection's manual order
  id, collection, bearing, title, category, discipline, year, image, dark, status, media -> radar.* metafields
  artwork image         -> product media (alt "Artwork: <title>")
Product media lists (photos, films) are kept as JSON in radar.media for now; Phase 4 moves them to Shopify media.
Everything is published to the Headless channel only.
"""
from pathlib import Path
from shopify_api import Admin
import html
import json
import re
import sys

ROOT = Path(__file__).resolve().parent.parent / 'site'
SIZES = ('XS', 'S', 'M', 'L', 'XL')
CURRENCY = 'INR'
VENDOR = 'RADAR STUDIO'
PRODUCT_TYPE = 'T-shirt'
TEST_STOCK = 10
SOLD_OUT = {'06': ('XS',), '13': ('XL',), '21': ('S',), '27': ('M', 'L'), '32': ('XL',)}  # test data for sold-out size rings

# radar.* metafields: key -> (owner, type, name). Readable by the Storefront API.
DEFINITIONS = {
    ('PRODUCT', 'id'): ('id', 'Site id'),
    ('PRODUCT', 'ring'): ('single_line_text_field', 'Radar ring (primary collection)'),
    ('PRODUCT', 'bearing'): ('number_integer', 'Radar bearing (degrees)'),
    ('PRODUCT', 'artwork_title'): ('single_line_text_field', 'Artwork title'),
    ('PRODUCT', 'category'): ('single_line_text_field', 'Artwork category'),
    ('PRODUCT', 'discipline'): ('single_line_text_field', 'Artwork discipline'),
    ('PRODUCT', 'year'): ('single_line_text_field', 'Artwork year'),
    ('PRODUCT', 'image'): ('single_line_text_field', 'Artwork file (site assets)'),
    ('PRODUCT', 'dark'): ('boolean', 'Washed black garment'),
    ('PRODUCT', 'status'): ('multi_line_text_field', 'Provenance note'),
    ('PRODUCT', 'media'): ('json', 'Product page media list'),
    ('COLLECTION', 'copy'): ('multi_line_text_field', 'Radar blurb'),
    ('COLLECTION', 'order'): ('number_integer', 'Radar order'),
}


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def product_metafields(p):
    values = {'id': p['id'], 'ring': p['collection'], 'bearing': str(p['bearing']), 'artwork_title': p['title'],
              'category': p['category'], 'discipline': p['discipline'], 'year': p['year'], 'image': p['image'],
              'dark': 'true' if p['dark'] else 'false', 'status': p.get('status', ''),
              'media': json.dumps(p['media']) if p.get('media') else ''}
    # No `type`: the definitions supply it, and productSet only recognises the customId metafield without one.
    return [{'namespace': 'radar', 'key': k, 'value': v} for k, v in values.items() if v != '']


def ensure_definitions(admin):
    for owner in ('PRODUCT', 'COLLECTION'):
        existing = {d['key']: d['type']['name'] for d in admin.graphql('''query($owner: MetafieldOwnerType!) {
          metafieldDefinitions(first: 50, ownerType: $owner, namespace: "radar") { nodes { key type { name } } } }''',
            {'owner': owner})['metafieldDefinitions']['nodes']}
        for (o, key), (kind, name) in DEFINITIONS.items():
            if o != owner:
                continue
            if key in existing:
                if existing[key] != kind:
                    raise SystemExit(f'metafield radar.{key} on {owner} is {existing[key]}, expected {kind}: fix it in the admin')
                continue
            definition = {'namespace': 'radar', 'key': key, 'name': name, 'ownerType': owner, 'type': kind,
                          'access': {'storefront': 'PUBLIC_READ'}}
            if kind == 'id':
                definition['capabilities'] = {'uniqueValues': {'enabled': True}}
            admin.graphql('''mutation($d: MetafieldDefinitionInput!) {
              metafieldDefinitionCreate(definition: $d) { createdDefinition { id } userErrors { field message } } }''', {'d': definition})
            print(f'  defined radar.{key} ({owner.lower()})')


def headless_publication(admin):
    found = [p for p in admin.graphql('{ publications(first: 50) { nodes { id name } } }')['publications']['nodes']
             if 'headless' in p['name'].lower()]
    if len(found) != 1:
        raise SystemExit(f'expected one Headless publication, found {[p["name"] for p in found]}')
    return found[0]['id']


def publish(admin, gid, publication):
    admin.graphql('''mutation($id: ID!, $p: ID!) {
      publishablePublish(id: $id, input: [{publicationId: $p}]) { userErrors { field message } } }''', {'id': gid, 'p': publication})


def sync_collections(admin, collections, publication):
    ids = {}
    for order, c in enumerate(collections):
        existing = admin.graphql('query($h: String!) { collectionByIdentifier(identifier: {handle: $h}) { id } }',
                                 {'h': c['id']})['collectionByIdentifier']
        fields = {'title': c['title'], 'handle': c['id'], 'sortOrder': 'MANUAL',
                  'descriptionHtml': '<p>' + html.escape(c['copy']).replace('\n', '<br>') + '</p>',
                  'metafields': [{'namespace': 'radar', 'key': 'copy', 'type': 'multi_line_text_field', 'value': c['copy']},
                                 {'namespace': 'radar', 'key': 'order', 'type': 'number_integer', 'value': str(order)}]}
        if existing:
            admin.graphql('''mutation($c: CollectionUpdateInput!) {
              collectionUpdate(collection: $c) { collection { id } userErrors { field message } } }''', {'c': {**fields, 'id': existing['id']}})
            ids[c['id']] = existing['id']
        else:
            ids[c['id']] = admin.graphql('''mutation($c: CollectionCreateInput!) {
              collectionCreate(collection: $c) { collection { id } userErrors { field message } } }''', {'c': fields})['collectionCreate']['collection']['id']
        publish(admin, ids[c['id']], publication)
        print(f'  collection {c["id"]}: {"updated" if existing else "created"}')
    return ids


def sync_product(admin, p, collection_id, location, publication, reset_stock):
    identifier = {'customId': {'namespace': 'radar', 'key': 'id', 'value': p['id']}}
    existing = admin.graphql('''query($i: ProductIdentifierInput!) {
      productByIdentifier(identifier: $i) { id media(first: 1) { nodes { id } } } }''', {'i': identifier})['productByIdentifier']
    variants = []
    for size in SIZES:
        variant = {'optionValues': [{'optionName': 'Size', 'name': size}], 'price': str(p['price']),
                   'compareAtPrice': str(p['original']) if p['original'] > p['price'] else None,
                   'inventoryPolicy': 'DENY', 'inventoryItem': {'sku': f'RADAR-{p["id"]}-{size}', 'tracked': True}}
        if not existing or reset_stock:
            quantity = 0 if size in SOLD_OUT.get(p['id'], ()) else TEST_STOCK
            variant['inventoryQuantities'] = [{'locationId': location, 'name': 'available', 'quantity': quantity}]
        variants.append(variant)
    product = {'title': p['name'], 'handle': slug(p['name']), 'redirectNewHandle': True, 'status': 'ACTIVE',
               'descriptionHtml': '<p>' + html.escape(p.get('description', '')) + '</p>',
               'vendor': VENDOR, 'productType': PRODUCT_TYPE, 'tags': [p['category']],
               'collections': [collection_id], 'metafields': product_metafields(p),
               'productOptions': [{'name': 'Size', 'values': [{'name': s} for s in SIZES]}], 'variants': variants}
    if not existing or not existing['media']['nodes']:
        product['files'] = [{'originalSource': admin.upload(ROOT / 'assets' / p['image'], 'IMAGE'),
                             'contentType': 'IMAGE', 'alt': 'Artwork: ' + p['title']}]
    gid = admin.graphql('''mutation($i: ProductSetInput!, $id: ProductSetIdentifiers) {
      productSet(input: $i, identifier: $id, synchronous: true) { product { id } userErrors { field message } } }''',
        {'i': product, 'id': identifier})['productSet']['product']['id']
    publish(admin, gid, publication)
    print(f'  {p["id"]} {p["name"]}: {"updated" if existing else "created"}' + (' + artwork' if 'files' in product else ''))
    return gid


def reorder(admin, collection_gid, ordered_gids):
    moves = [{'id': gid, 'newPosition': str(i)} for i, gid in enumerate(ordered_gids)]
    job = admin.graphql('''mutation($id: ID!, $m: [MoveInput!]!) {
      collectionReorderProducts(id: $id, moves: $m) { job { id done } userErrors { field message } } }''',
        {'id': collection_gid, 'm': moves})['collectionReorderProducts']['job']
    admin.wait_for_job(job)


# ---------- Read back and compare ----------

READ_PRODUCTS = '''query($after: String) { products(first: 100, after: $after) {
  pageInfo { hasNextPage endCursor }
  nodes { id title handle descriptionHtml status vendor productType
    metafields(first: 30, namespace: "radar") { nodes { key value } }
    variants(first: 20) { nodes { sku price compareAtPrice inventoryQuantity selectedOptions { name value } } }
    media(first: 10) { nodes { alt mediaContentType } }
    collections(first: 10) { nodes { handle } }
    resourcePublicationsV2(first: 10, onlyPublished: true) { nodes { publication { id } } } } } }'''
READ_COLLECTION = '''query($h: String!, $after: String) { collectionByIdentifier(identifier: {handle: $h}) {
  title sortOrder metafields(first: 10, namespace: "radar") { nodes { key value } }
  resourcePublicationsV2(first: 10, onlyPublished: true) { nodes { publication { id } } }
  products(first: 250, after: $after, sortKey: COLLECTION_DEFAULT) { pageInfo { hasNextPage endCursor } nodes { id } } } }'''


def as_int(money):
    return int(round(float(money)))


def check(admin, collections, products, publication, only=None):
    """Compare the store with products.json. Returns a list of problems (empty when everything round-trips)."""
    problems = []
    currency = admin.graphql('{ shop { currencyCode } }')['shop']['currencyCode']
    if currency != CURRENCY:
        problems.append(f'store currency is {currency}, expected {CURRENCY}')
    store = {}
    for node in admin.pages(READ_PRODUCTS, ['products']):
        meta = {m['key']: m['value'] for m in node['metafields']['nodes']}
        if 'id' in meta:
            store[meta['id']] = (node, meta)
    wanted = [p for p in products if not only or p['id'] in only]
    if not only:
        problems += [f'{i}: in the store but not in products.json' for i in sorted(set(store) - {p['id'] for p in products})]
    for p in wanted:
        if p['id'] not in store:
            problems.append(f'{p["id"]}: missing from the store')
            continue
        node, meta = store[p['id']]
        variants = {v['selectedOptions'][0]['value']: v for v in node['variants']['nodes']}
        prices = {as_int(v['price']) for v in variants.values()}
        compare = {as_int(v['compareAtPrice']) if v['compareAtPrice'] else None for v in variants.values()}
        got = {
            'name': node['title'], 'description': html.unescape(re.sub(r'^<p>|</p>$', '', node['descriptionHtml'])),
            'collection': meta.get('ring'), 'bearing': int(meta['bearing']) if 'bearing' in meta else None,
            'title': meta.get('artwork_title'), 'category': meta.get('category'), 'discipline': meta.get('discipline'),
            'year': meta.get('year'), 'image': meta.get('image'), 'dark': meta.get('dark') == 'true',
            'status': meta.get('status', ''), 'media': json.loads(meta['media']) if 'media' in meta else None,
            'price': prices.pop() if len(prices) == 1 else sorted(prices),
            'original': None,
        }
        compare = compare.pop() if len(compare) == 1 else sorted(compare, key=str)
        got['original'] = compare if compare is not None else got['price']
        want = {k: p.get(k, '' if k in ('description', 'status') else None) for k in got}
        problems += [f'{p["id"]}: {k} is {got[k]!r}, expected {want[k]!r}' for k in got if got[k] != want[k]]
        if node['handle'] != slug(p['name']):
            problems.append(f'{p["id"]}: handle is {node["handle"]}, expected {slug(p["name"])}')
        if sorted(variants) != sorted(SIZES):
            problems.append(f'{p["id"]}: sizes are {sorted(variants)}')
        problems += [f'{p["id"]}: {s} SKU is {v["sku"]}' for s, v in variants.items() if v['sku'] != f'RADAR-{p["id"]}-{s}']
        if [c['handle'] for c in node['collections']['nodes']] != [p['collection']]:
            problems.append(f'{p["id"]}: collections are {[c["handle"] for c in node["collections"]["nodes"]]}')
        if node['status'] != 'ACTIVE':
            problems.append(f'{p["id"]}: status {node["status"]}')
        if publication not in {r['publication']['id'] for r in node['resourcePublicationsV2']['nodes']}:
            problems.append(f'{p["id"]}: not published to the Headless channel')
        if not any(m['mediaContentType'] == 'IMAGE' and m['alt'] == 'Artwork: ' + p['title'] for m in node['media']['nodes']):
            problems.append(f'{p["id"]}: artwork image missing')
    for order, c in enumerate(collections):
        nodes, after, info = [], None, None
        while True:
            data = admin.graphql(READ_COLLECTION, {'h': c['id'], 'after': after})['collectionByIdentifier']
            if not data:
                break
            info = info or data
            nodes += data['products']['nodes']
            if not data['products']['pageInfo']['hasNextPage']:
                break
            after = data['products']['pageInfo']['endCursor']
        if not info:
            problems.append(f'collection {c["id"]}: missing from the store')
            continue
        meta = {m['key']: m['value'] for m in info['metafields']['nodes']}
        if info['title'] != c['title'] or meta.get('copy') != c['copy'] or meta.get('order') != str(order):
            problems.append(f'collection {c["id"]}: title, blurb or order differs')
        if info['sortOrder'] != 'MANUAL':
            problems.append(f'collection {c["id"]}: sort order is {info["sortOrder"]}')
        if publication not in {r['publication']['id'] for r in info['resourcePublicationsV2']['nodes']}:
            problems.append(f'collection {c["id"]}: not published to the Headless channel')
        gid_to_id = {store[i][0]['id']: i for i in store}
        got = [gid_to_id.get(n['id']) for n in nodes]
        want = [p['id'] for p in sorted((p for p in products if p['collection'] == c['id']), key=lambda p: p['position'])]
        if not only and got != want:
            problems.append(f'collection {c["id"]}: order is {got}, expected {want}')
    return problems


def main():
    args = sys.argv[1:]
    only = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
    source = json.loads((ROOT / 'data' / 'products.json').read_text())
    collections, products = source['collections'], source['products']
    unknown = (only or set()) - {p['id'] for p in products}
    bad_stock = set(SOLD_OUT) - {p['id'] for p in products}
    handles = [slug(p['name']) for p in products]
    if unknown or bad_stock or len(handles) != len(set(handles)):
        raise SystemExit(f'unknown ids {sorted(unknown | bad_stock)} or duplicate product handles')

    admin = Admin()
    print(f'Store {admin.domain} (API {admin.version})')
    publication = headless_publication(admin)
    if '--check' not in args:
        currency = admin.graphql('{ shop { currencyCode } }')['shop']['currencyCode']
        if currency != CURRENCY:
            raise SystemExit(f'Store currency is {currency}; set it to {CURRENCY} in Settings → General before importing.')
        location = admin.graphql('{ locations(first: 1) { nodes { id } } }')['locations']['nodes'][0]['id']
        print('Definitions'); ensure_definitions(admin)
        print('Collections'); collection_ids = sync_collections(admin, collections, publication)
        print('Products')
        gids = {p['id']: sync_product(admin, p, collection_ids[p['collection']], location, publication, '--reset-stock' in args)
                for p in products if not only or p['id'] in only}
        if not only:
            print('Order')
            for c in collections:
                reorder(admin, collection_ids[c['id']],
                        [gids[p['id']] for p in sorted((p for p in products if p['collection'] == c['id']), key=lambda p: p['position'])])
    print('Check')
    problems = check(admin, collections, products, publication, only)
    for problem in problems:
        print('  FAIL', problem)
    count = len(only) if only else len(products)
    print(f'  {"all fields round-trip" if not problems else str(len(problems)) + " problems"} '
          f'({count} pieces, {len(collections)} collections)')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
