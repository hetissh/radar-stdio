/**
 * @fileoverview Tests for the Shopify webhook function: signature checks, the
 * topics it reacts to, and when it triggers or skips a rebuild. Network calls
 * go to a fake fetch.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

// Node 18 has no global Web Crypto; Cloudflare Workers do.
globalThis.crypto ??= nodeCrypto.webcrypto;

const SECRET = 'test-secret';
const HOOK_URL = 'https://deploy.example/hook';
const SOURCE = path.join(
  __dirname,
  '..',
  '..',
  'functions',
  'api',
  'shopify-webhook.js',
);

/**
 * The function module. The repo's package.json doesn't declare ES modules
 * (the site uses classic scripts), so the file is imported as an ES module
 * from its source text rather than by path.
 * @return {!Promise<!object>}
 */
function loadWebhook() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

/**
 * A signed webhook request, as Shopify would send it.
 * @param {{topic: string, body: (string|undefined),
 *     signature: (string|undefined)}} options
 * @return {!Request}
 */
function shopifyRequest({ topic, body = '{"id":1}', signature }) {
  const hmac =
    signature ??
    nodeCrypto.createHmac('sha256', SECRET).update(body).digest('base64');
  return new Request('https://site.example/api/shopify-webhook', {
    method: 'POST',
    body,
    headers: { 'x-shopify-hmac-sha256': hmac, 'x-shopify-topic': topic },
  });
}

/**
 * A fake fetch that records calls and answers from a table.
 * @param {!Record<string, !Response>} answers By URL prefix.
 * @return {{fetch: function(string, !object): !Promise<!Response>,
 *     calls: !Array<string>}}
 */
function fakeNetwork(answers) {
  const calls = [];
  return {
    calls,
    fetch: async url => {
      calls.push(url);
      const prefix = Object.keys(answers).find(key => url.startsWith(key));
      if (!prefix) throw new Error(`unexpected fetch: ${url}`);
      return answers[prefix];
    },
  };
}

const env = { SHOPIFY_CLIENT_SECRET: SECRET, DEPLOY_HOOK_URL: HOOK_URL };

test('verifySignature() accepts only the right HMAC', async () => {
  const { verifySignature } = await loadWebhook();
  const body = new TextEncoder().encode('{"id":1}');
  const good = nodeCrypto
    .createHmac('sha256', SECRET)
    .update('{"id":1}')
    .digest('base64');
  assert.equal(await verifySignature(body, good, SECRET), true);
  assert.equal(await verifySignature(body, good, 'other-secret'), false);
  assert.equal(await verifySignature(body, 'not base64!', SECRET), false);
  assert.equal(await verifySignature(body, null, SECRET), false);
  assert.equal(await verifySignature(body, good, undefined), false);
});

test('a bad signature is rejected with 401', async () => {
  const { onRequestPost } = await loadWebhook();
  const network = fakeNetwork({});
  const request = shopifyRequest({
    topic: 'products/update',
    signature: 'AAAA',
  });
  const response = await onRequestPost({ request, env }, network.fetch);
  assert.equal(response.status, 401);
  assert.equal(network.calls.length, 0);
});

test('topics it does not handle are acknowledged and ignored', async () => {
  const { onRequestPost } = await loadWebhook();
  const network = fakeNetwork({});
  const request = shopifyRequest({ topic: 'orders/create' });
  const response = await onRequestPost({ request, env }, network.fetch);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ignored: 'orders/create' });
  assert.equal(network.calls.length, 0);
});

test('a catalogue change triggers the deploy hook (202)', async () => {
  const { onRequestPost } = await loadWebhook();
  const network = fakeNetwork({
    [HOOK_URL]: new Response('', { status: 200 }),
  });
  const request = shopifyRequest({ topic: 'products/update' });
  const response = await onRequestPost({ request, env }, network.fetch);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    topic: 'products/update',
    rebuild: 'triggered',
  });
  assert.deepEqual(network.calls, [HOOK_URL]);
});

test('a failed deploy hook returns 502 so Shopify retries', async () => {
  const { onRequestPost } = await loadWebhook();
  const network = fakeNetwork({
    [HOOK_URL]: new Response('', { status: 500 }),
  });
  const request = shopifyRequest({ topic: 'collections/delete' });
  const response = await onRequestPost({ request, env }, network.fetch);
  assert.equal(response.status, 502);
});

test('a missing DEPLOY_HOOK_URL is a 500', async () => {
  const { onRequestPost } = await loadWebhook();
  const request = shopifyRequest({ topic: 'products/create' });
  const response = await onRequestPost(
    { request, env: { SHOPIFY_CLIENT_SECRET: SECRET } },
    fakeNetwork({}).fetch,
  );
  assert.equal(response.status, 500);
});

test('a build already waiting to start is not duplicated', async () => {
  const { onRequestPost } = await loadWebhook();
  const deployments = {
    result: [
      {
        environment: 'production',
        latest_stage: { name: 'queued', status: 'active' },
      },
    ],
  };
  const network = fakeNetwork({
    'https://api.cloudflare.com/': Response.json(deployments),
  });
  const request = shopifyRequest({ topic: 'products/update' });
  const fullEnv = {
    ...env,
    CF_API_TOKEN: 't',
    CF_ACCOUNT_ID: 'a',
    CF_PAGES_PROJECT: 'p',
  };
  const response = await onRequestPost(
    { request, env: fullEnv },
    network.fetch,
  );
  assert.deepEqual(await response.json(), {
    topic: 'products/update',
    rebuild: 'already queued',
  });
  assert.equal(network.calls.length, 1);
});

test('buildPending() is false when unsure', async () => {
  const { buildPending } = await loadWebhook();
  const fullEnv = {
    CF_API_TOKEN: 't',
    CF_ACCOUNT_ID: 'a',
    CF_PAGES_PROJECT: 'p',
  };
  assert.equal(await buildPending({}, fakeNetwork({}).fetch), false);
  const failing = async () => {
    throw new Error('network down');
  };
  assert.equal(await buildPending(fullEnv, failing), false);
  const stopped = fakeNetwork({
    'https://api.cloudflare.com/': Response.json({
      result: [
        {
          environment: 'production',
          latest_stage: { name: 'queued', status: 'canceled' },
        },
      ],
    }),
  });
  assert.equal(await buildPending(fullEnv, stopped.fetch), false);
});
