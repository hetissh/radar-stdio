"""Subscribes the store's catalogue webhooks to the site's rebuild function.

Run:
  python3 scripts/shopify_webhooks.py https://<project>.pages.dev
      subscribe (re-runnable; moves existing subscriptions to this URL)
  python3 scripts/shopify_webhooks.py --list
      show this app's subscriptions
  python3 scripts/shopify_webhooks.py --remove
      remove this app's catalogue subscriptions

The function is functions/api/shopify-webhook.js. Subscriptions belong to the
Dev Dashboard app in .env, so Shopify signs them with its client secret: the
same SHOPIFY_CLIENT_SECRET the function checks. Payloads are trimmed to the
id, since the function only needs the signature. Stock changes aren't
subscribed: live stock comes from the Storefront API, not from the build.
"""

from __future__ import annotations

import argparse

from shopify_api import Admin, Json

TOPICS = [
    'PRODUCTS_CREATE',
    'PRODUCTS_UPDATE',
    'PRODUCTS_DELETE',
    'COLLECTIONS_CREATE',
    'COLLECTIONS_UPDATE',
    'COLLECTIONS_DELETE',
    'PRODUCT_PUBLICATIONS_CREATE',
    'PRODUCT_PUBLICATIONS_UPDATE',
    'PRODUCT_PUBLICATIONS_DELETE',
    'COLLECTION_PUBLICATIONS_CREATE',
    'COLLECTION_PUBLICATIONS_UPDATE',
    'COLLECTION_PUBLICATIONS_DELETE',
]
PATH = '/api/shopify-webhook'
LIST = """query($after: String) {
  webhookSubscriptions(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor } nodes { id topic uri } } }"""
DELETE = """mutation($id: ID!) { webhookSubscriptionDelete(id: $id) {
  deletedWebhookSubscriptionId userErrors { field message } } }"""
CREATE = """mutation($t: WebhookSubscriptionTopic!,
  $w: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $t, webhookSubscription: $w) {
    webhookSubscription { id } userErrors { field message } } }"""


def our_subscriptions(admin: Admin) -> list[Json]:
    """Returns this app's catalogue subscriptions to a rebuild function.

    Args:
        admin: The session.
    """
    return [
        subscription
        for subscription in admin.pages(LIST, ['webhookSubscriptions'])
        if subscription['topic'] in TOPICS
        and subscription['uri'].endswith(PATH)
    ]


def list_subscriptions(subscriptions: list[Json]) -> None:
    """Prints each subscription and how many topics are covered.

    Args:
        subscriptions: From our_subscriptions().
    """
    for subscription in subscriptions:
        print(f'{subscription["topic"]:<32} {subscription["uri"]}')
    print(f'{len(subscriptions)} of {len(TOPICS)} topics subscribed')


def remove_subscriptions(admin: Admin, subscriptions: list[Json]) -> None:
    """Deletes subscriptions.

    Args:
        admin: The session.
        subscriptions: From our_subscriptions().
    """
    for subscription in subscriptions:
        admin.graphql(DELETE, {'id': subscription['id']})
        print(f'removed {subscription["topic"]}')


def subscribe(admin: Admin, subscriptions: list[Json], site: str) -> None:
    """Points every topic at the site's function, moving any elsewhere.

    Args:
        admin: The session.
        subscriptions: Existing ones, from our_subscriptions().
        site: The site's base URL (https://...).

    Raises:
        SystemExit: The URL isn't https.
    """
    base = site.rstrip('/')
    if not base.startswith('https://'):
        raise SystemExit(
            'give the site URL, e.g. https://radar-stdio.pages.dev'
        )
    uri = base + PATH
    by_topic = {
        subscription['topic']: subscription for subscription in subscriptions
    }
    for topic in TOPICS:
        existing = by_topic.get(topic)
        if existing and existing['uri'] == uri:
            print(f'ok      {topic}')
            continue
        if existing:
            admin.graphql(DELETE, {'id': existing['id']})
        admin.graphql(
            CREATE,
            {
                't': topic,
                'w': {'uri': uri, 'format': 'JSON', 'includeFields': ['id']},
            },
        )
        print(f'{"moved  " if existing else "added  "} {topic}')
    print(f'{len(TOPICS)} topics → {uri}')


def parse_args() -> argparse.Namespace:
    """Reads the command-line options."""
    parser = argparse.ArgumentParser(
        description="Manage the store's catalogue webhooks."
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument('site', nargs='?', help='subscribe to this site URL')
    action.add_argument(
        '--list', action='store_true', help='show subscriptions'
    )
    action.add_argument(
        '--remove', action='store_true', help='remove the subscriptions'
    )
    return parser.parse_args()


def main() -> None:
    """Lists (the default), removes or subscribes."""
    args = parse_args()
    admin = Admin()
    subscriptions = our_subscriptions(admin)
    if args.remove:
        remove_subscriptions(admin, subscriptions)
    elif args.site:
        subscribe(admin, subscriptions, args.site)
    else:
        list_subscriptions(subscriptions)


if __name__ == '__main__':
    main()
