/**
 * @fileoverview Cloudflare Pages Function: POST /api/shopify-webhook.
 *
 * Shopify calls this when a product or collection changes (subscriptions:
 * scripts/shopify_webhooks.py). It checks the signature, then triggers a
 * Pages rebuild, whose first step (scripts/sync_shopify.py) reads the store
 * again.
 *
 * Environment (Cloudflare → Settings → Variables and Secrets, all Secret):
 * - SHOPIFY_CLIENT_SECRET: the Dev Dashboard app's secret; Shopify signs
 *   webhooks with it.
 * - DEPLOY_HOOK_URL: Pages → Settings → Builds → Deploy hooks (branch main).
 * - CF_API_TOKEN, CF_ACCOUNT_ID, CF_PAGES_PROJECT (optional): a token with
 *   Pages read access. With them, a webhook that arrives while a build is
 *   still waiting to start is skipped (that build will read the change
 *   anyway), so a burst of edits costs one or two builds instead of one each.
 */

const TOPICS = new Set([
  'products/create',
  'products/update',
  'products/delete',
  'collections/create',
  'collections/update',
  'collections/delete',
  'product_publications/create',
  'product_publications/update',
  'product_publications/delete',
  'collection_publications/create',
  'collection_publications/update',
  'collection_publications/delete',
]);
// Build stages that run before sync_shopify.py reads the store.
const BEFORE_SYNC = new Set(['queued', 'initialize', 'clone_repo']);
// Build stage outcomes that mean the build won't run after all.
const STOPPED = ['failure', 'canceled', 'skipped'];

/**
 * A JSON response.
 * @param {*} body
 * @param {number=} status
 * @return {!Response}
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Checks Shopify's HMAC-SHA256 signature of the raw request body.
 * @param {!ArrayBuffer} body
 * @param {?string} signature The X-Shopify-Hmac-Sha256 header (base64).
 * @param {string|undefined} secret The app's client secret.
 * @return {!Promise<boolean>}
 */
export async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;
  let expected;
  try {
    expected = Uint8Array.from(atob(signature), char => char.charCodeAt(0));
  } catch {
    // Not valid base64: it can't be a genuine signature.
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  // verify() compares in constant time.
  return crypto.subtle.verify('HMAC', key, expected, body);
}

/**
 * Whether a production deployment is already waiting to start, so it will
 * include this change anyway.
 * @param {!Object<string, string>} env
 * @param {function(string, !Object): !Promise<!Response>=} fetchImpl
 * @return {!Promise<boolean>}
 */
export async function buildPending(env, fetchImpl = fetch) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_PAGES_PROJECT) {
    return false;
  }
  try {
    const url =
      'https://api.cloudflare.com/client/v4/accounts/' +
      `${env.CF_ACCOUNT_ID}/pages/projects/${env.CF_PAGES_PROJECT}/` +
      'deployments?per_page=5';
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
    });
    if (!response.ok) return false;
    const { result = [] } = await response.json();
    return result.some(
      deployment =>
        deployment.environment === 'production' &&
        BEFORE_SYNC.has(deployment.latest_stage?.name) &&
        !STOPPED.includes(deployment.latest_stage?.status),
    );
  } catch {
    // When unsure, rebuild: freshness beats saving a build.
    return false;
  }
}

/**
 * Handles a webhook: verify, then trigger a rebuild unless one is pending.
 * @param {{request: !Request, env: !Object<string, string>}} context
 * @param {function(string, !Object): !Promise<!Response>=} fetchImpl
 * @return {!Promise<!Response>}
 */
export async function onRequestPost({ request, env }, fetchImpl = fetch) {
  const body = await request.arrayBuffer();
  const signed = await verifySignature(
    body,
    request.headers.get('x-shopify-hmac-sha256'),
    env.SHOPIFY_CLIENT_SECRET,
  );
  if (!signed) return json({ error: 'invalid signature' }, 401);
  const topic = request.headers.get('x-shopify-topic') || '';
  if (!TOPICS.has(topic)) return json({ ignored: topic });
  if (!env.DEPLOY_HOOK_URL) {
    return json({ error: 'DEPLOY_HOOK_URL not set' }, 500);
  }
  if (await buildPending(env, fetchImpl)) {
    return json({ topic, rebuild: 'already queued' });
  }
  const hook = await fetchImpl(env.DEPLOY_HOOK_URL, { method: 'POST' });
  // A failed trigger returns 502 so Shopify retries the webhook later.
  return hook.ok
    ? json({ topic, rebuild: 'triggered' }, 202)
    : json({ topic, error: `deploy hook ${hook.status}` }, 502);
}
