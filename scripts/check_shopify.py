"""Check that the Shopify keys in .env (or the environment) work. Prints results only, never key values.

Run: python3 scripts/check_shopify.py

Storefront API: queries the shop with the public token, then with the private token, and checks that Shopify
serves the pinned API version. Admin API (only if SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are set): exchanges
them for a short-lived token (client credentials grant) and lists the granted scopes.
Exits non-zero if any configured check fails.
"""
from build_config import load_env, public_config
import json
import sys
import urllib.error
import urllib.request

env = load_env()
config = public_config(env)
if not config:
    raise SystemExit('No store configured: set SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_PUBLIC_TOKEN in .env')
domain, version = config['domain'], config['apiVersion']
failed = False


def post(url, body, headers):
    """POST JSON; return (status, served API version, parsed body)."""
    request = urllib.request.Request(url, json.dumps(body).encode(), {'Content-Type': 'application/json', **headers})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.headers.get('X-Shopify-API-Version'), json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get('X-Shopify-API-Version'), None


def report(label, ok, detail):
    global failed
    failed |= not ok
    print(f'{"ok  " if ok else "FAIL"} {label}: {detail}')


SHOP_QUERY = {'query': '{ shop { name } products(first: 250) { edges { node { id } } } }'}
storefront = f'https://{domain}/api/{version}/graphql.json'
for label, key, header in (('Storefront public token', 'SHOPIFY_STOREFRONT_PUBLIC_TOKEN', 'X-Shopify-Storefront-Access-Token'),
                           ('Storefront private token', 'SHOPIFY_STOREFRONT_PRIVATE_TOKEN', 'Shopify-Storefront-Private-Token')):
    if key not in env:
        print(f'skip {label}: {key} not set')
        continue
    try:
        status, served, body = post(storefront, SHOP_QUERY, {header: env[key]})
    except urllib.error.URLError as error:
        report(label, False, f'could not reach {domain} ({error.reason})')
        continue
    if status != 200 or not body or body.get('errors'):
        report(label, False, f'HTTP {status}' + (f', {body["errors"][0].get("message")}' if body and body.get('errors') else ''))
        continue
    shop = body['data']['shop']['name']
    count = len(body['data']['products']['edges'])
    report(label, True, f'shop "{shop}", {count} product{"s" if count != 1 else ""} visible to the Headless channel')
    if served and served != version:
        report('API version', False, f'asked for {version}, Shopify served {served}: set SHOPIFY_API_VERSION to a supported version')

if 'SHOPIFY_CLIENT_ID' in env and 'SHOPIFY_CLIENT_SECRET' in env:
    status, _, body = post(f'https://{domain}/admin/oauth/access_token',
                           {'client_id': env['SHOPIFY_CLIENT_ID'], 'client_secret': env['SHOPIFY_CLIENT_SECRET'],
                            'grant_type': 'client_credentials'}, {})
    if status != 200 or not body or 'access_token' not in body:
        report('Admin API token', False, f'HTTP {status}: check the app is installed on {domain} and the ID/secret are from that app')
    else:
        scopes = sorted(body.get('scope', '').split(','))
        report('Admin API token', True, f'granted scopes: {", ".join(s for s in scopes if s) or "none"}')
else:
    print('skip Admin API: SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET not set (Dev Dashboard app)')

sys.exit(1 if failed else 0)
