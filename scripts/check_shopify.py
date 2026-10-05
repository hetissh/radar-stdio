"""Checks that the Shopify keys in .env (or the environment) work.

Run: python3 scripts/check_shopify.py

Storefront API: queries the shop with the public token, then with the private
token, and checks that Shopify serves the pinned API version. Admin API (only
if SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are set): exchanges them for a
short-lived token (client credentials grant) and lists the granted scopes.
Prints results only, never key values. Exits non-zero if any configured check
fails.
"""

from __future__ import annotations

import json
import sys
import urllib.error
from typing import Any

from build_config import public_config
from environment import load_env
from shopify_api import json_request, send

TIMEOUT = 20  # seconds
SHOP_QUERY = {
    'query': '{ shop { name } products(first: 250) { edges { node { id } } } }'
}
# (label, setting, header) for each Storefront token.
STOREFRONT_TOKENS = (
    (
        'Storefront public token',
        'SHOPIFY_STOREFRONT_PUBLIC_TOKEN',
        'X-Shopify-Storefront-Access-Token',
    ),
    (
        'Storefront private token',
        'SHOPIFY_STOREFRONT_PRIVATE_TOKEN',
        'Shopify-Storefront-Private-Token',
    ),
)


class Report:
    """Prints check results and remembers whether any failed."""

    def __init__(self) -> None:
        """Starts with no failures."""
        self.any_failed = False

    def passed(self, label: str, detail: str) -> None:
        """Prints a passing check.

        Args:
            label: What was checked.
            detail: What was found.
        """
        print(f'ok   {label}: {detail}')

    def failed(self, label: str, detail: str) -> None:
        """Prints a failing check and remembers the failure.

        Args:
            label: What was checked.
            detail: What went wrong.
        """
        self.any_failed = True
        print(f'FAIL {label}: {detail}')


def post(
    url: str, payload: object, headers: dict[str, str]
) -> tuple[int, str | None, Any]:
    """POSTs JSON.

    Args:
        url: Where to send it.
        payload: The JSON body.
        headers: Extra headers.

    Returns:
        (status, the API version Shopify served, the parsed body or None for
        an error status).
    """
    reply = send(json_request(url, payload, headers), TIMEOUT)
    served = reply.headers.get('X-Shopify-API-Version')
    return reply.status, served, json.loads(reply.body) if reply.ok else None


def check_storefront(
    env: dict[str, str], config: dict[str, str], report: Report
) -> None:
    """Queries the Storefront API with each configured token.

    Args:
        env: Settings.
        config: The public settings (domain, apiVersion).
        report: Where results go.
    """
    domain, version = config['domain'], config['apiVersion']
    url = f'https://{domain}/api/{version}/graphql.json'
    for label, key, header in STOREFRONT_TOKENS:
        if key not in env:
            print(f'skip {label}: {key} not set')
            continue
        try:
            status, served, body = post(url, SHOP_QUERY, {header: env[key]})
        except urllib.error.URLError as error:
            report.failed(label, f'could not reach {domain} ({error.reason})')
            continue
        if status != 200 or not body or body.get('errors'):
            message = ''
            if body and body.get('errors'):
                message = f', {body["errors"][0].get("message")}'
            report.failed(label, f'HTTP {status}{message}')
            continue
        shop = body['data']['shop']['name']
        count = len(body['data']['products']['edges'])
        plural = 's' if count != 1 else ''
        report.passed(
            label,
            f'shop "{shop}", {count} product{plural} visible to the Headless '
            'channel',
        )
        if served and served != version:
            report.failed(
                'API version',
                f'asked for {version}, Shopify served {served}: set '
                'SHOPIFY_API_VERSION to a supported version',
            )


def check_admin(env: dict[str, str], domain: str, report: Report) -> None:
    """Requests an Admin API token and lists its scopes.

    Args:
        env: Settings.
        domain: The store's .myshopify.com domain.
        report: Where results go.
    """
    if 'SHOPIFY_CLIENT_ID' not in env or 'SHOPIFY_CLIENT_SECRET' not in env:
        print(
            'skip Admin API: SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET not set '
            '(Dev Dashboard app)'
        )
        return
    credentials = {
        'client_id': env['SHOPIFY_CLIENT_ID'],
        'client_secret': env['SHOPIFY_CLIENT_SECRET'],
        'grant_type': 'client_credentials',
    }
    status, _, body = post(
        f'https://{domain}/admin/oauth/access_token', credentials, {}
    )
    if status != 200 or not body or 'access_token' not in body:
        report.failed(
            'Admin API token',
            f'HTTP {status}: check the app is installed on {domain} and the '
            'ID/secret are from that app',
        )
        return
    scopes = [
        scope for scope in sorted(body.get('scope', '').split(',')) if scope
    ]
    report.passed(
        'Admin API token', f'granted scopes: {", ".join(scopes) or "none"}'
    )


def main() -> None:
    """Runs every configured check; exits 1 if any failed."""
    env = load_env()
    config = public_config(env)
    if not config:
        raise SystemExit(
            'No store configured: set SHOPIFY_STORE_DOMAIN and '
            'SHOPIFY_STOREFRONT_PUBLIC_TOKEN in .env'
        )
    report = Report()
    check_storefront(env, config, report)
    check_admin(env, config['domain'], report)
    sys.exit(1 if report.any_failed else 0)


if __name__ == '__main__':
    main()
