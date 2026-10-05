"""Subscribe the store's catalogue webhooks to the site's rebuild function (functions/api/shopify-webhook.js).

Run:
  python3 scripts/shopify_webhooks.py https://<project>.pages.dev   subscribe (re-runnable; moves existing ones to this URL)
  python3 scripts/shopify_webhooks.py --list                        show this app's subscriptions
  python3 scripts/shopify_webhooks.py --remove                      remove this app's catalogue subscriptions

Subscriptions belong to the Dev Dashboard app in .env, so Shopify signs them with its client secret, the same
SHOPIFY_CLIENT_SECRET the function checks. Payloads are trimmed to the id: the function only needs the signature.
Stock changes aren't subscribed: live stock comes from the Storefront API (Phase 3), not from the build.
"""
from shopify_api import Admin
import sys

TOPICS = ['PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE',
          'COLLECTIONS_CREATE', 'COLLECTIONS_UPDATE', 'COLLECTIONS_DELETE',
          'PRODUCT_PUBLICATIONS_CREATE', 'PRODUCT_PUBLICATIONS_UPDATE', 'PRODUCT_PUBLICATIONS_DELETE',
          'COLLECTION_PUBLICATIONS_CREATE', 'COLLECTION_PUBLICATIONS_UPDATE', 'COLLECTION_PUBLICATIONS_DELETE']
PATH = '/api/shopify-webhook'
LIST = '''query($after: String) { webhookSubscriptions(first: 100, after: $after) {
  pageInfo { hasNextPage endCursor } nodes { id topic uri } } }'''


def main():
    args = sys.argv[1:]
    admin = Admin()
    ours = [s for s in admin.pages(LIST, ['webhookSubscriptions']) if s['topic'] in TOPICS and s['uri'].endswith(PATH)]
    if not args or args[0] == '--list':
        for s in ours:
            print(f'{s["topic"]:<32} {s["uri"]}')
        print(f'{len(ours)} of {len(TOPICS)} topics subscribed')
        return
    if args[0] == '--remove':
        for s in ours:
            admin.graphql('mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } } }', {'id': s['id']})
            print(f'removed {s["topic"]}')
        return
    base = args[0].rstrip('/')
    if not base.startswith('https://'):
        raise SystemExit('give the site URL, e.g. https://radar-stdio.pages.dev')
    uri = base + PATH
    by_topic = {s['topic']: s for s in ours}
    for topic in TOPICS:
        existing = by_topic.get(topic)
        if existing and existing['uri'] == uri:
            print(f'ok      {topic}')
            continue
        if existing:
            admin.graphql('mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } } }', {'id': existing['id']})
        admin.graphql('''mutation($t: WebhookSubscriptionTopic!, $w: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $t, webhookSubscription: $w) { webhookSubscription { id } userErrors { field message } } }''',
                      {'t': topic, 'w': {'uri': uri, 'format': 'JSON', 'includeFields': ['id']}})
        print(f'{"moved  " if existing else "added  "} {topic}')
    print(f'{len(TOPICS)} topics → {uri}')


if __name__ == '__main__':
    main()
