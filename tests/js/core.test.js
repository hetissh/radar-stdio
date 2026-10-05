/**
 * @fileoverview Tests for the core browser modules: formatting, storage,
 * catalogue data and bearings, artwork and piece helpers, and the radar maths.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts, CORE } = require('../helpers/browser.js');

test('esc() escapes every HTML-significant character', () => {
  const page = loadScripts(CORE);
  assert.equal(
    page.run(`esc('<a href="x">Tom & Jerry\\'s</a>')`),
    '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
  );
  assert.equal(page.run('esc(null) + esc(undefined)'), '');
  assert.equal(page.run('esc(0)'), '0');
  assert.equal(page.run(`escLines('one\\n<two>')`), 'one<br>&lt;two&gt;');
});

test('pad(), clamp() and money() format numbers', () => {
  const page = loadScripts(CORE);
  assert.equal(page.run('pad(7)'), '07');
  assert.equal(page.run('pad(45, 3)'), '045');
  assert.equal(page.run('pad(123)'), '123');
  assert.equal(page.run('clamp(5, 0, 3)'), 3);
  assert.equal(page.run('clamp(-1, 0, 3)'), 0);
  assert.equal(page.run('clamp(2, 0, 3)'), 2);
  assert.equal(page.run('money(123456)'), '₹1,23,456');
  assert.equal(page.run('money(2400)'), '₹2,400');
});

test('storage helpers never throw when storage is blocked', () => {
  const page = loadScripts(CORE, { brokenStorage: true });
  assert.equal(page.run(`localStore.get('radar-bag')`), null);
  assert.doesNotThrow(() => page.run(`localStore.set('radar-bag', '[]')`));
  assert.doesNotThrow(() => page.run(`sessionStore.remove('radar-stress')`));
});

test('storage helpers read back what they wrote', () => {
  const page = loadScripts(CORE);
  page.run(`sessionStore.set('key', 42)`);
  assert.equal(page.run(`sessionStore.get('key')`), '42');
  page.run(`sessionStore.remove('key')`);
  assert.equal(page.run(`sessionStore.get('key')`), null);
});

test('freeBearing() picks the middle of the widest gap', () => {
  const page = loadScripts(CORE);
  assert.equal(page.run('freeBearing([])'), 0);
  assert.equal(page.run('freeBearing([10])'), 190);
  assert.equal(page.run('freeBearing([0, 90, 200])'), 280);
  assert.equal(page.run('freeBearing([359.5, 1, 45.25])'), 202.4);
});

test('bearingLabel() pads whole and fractional bearings', () => {
  const page = loadScripts(CORE);
  assert.equal(page.run('bearingLabel({ bearing: 45 })'), '045');
  assert.equal(page.run('bearingLabel({ bearing: 7.5 })'), '007.5');
  assert.equal(page.run('bearingLabel({ bearing: 270 })'), '270');
});

test('radarData.all() loads every piece with ring indexes', async () => {
  const page = loadScripts(CORE);
  await page.run('radarData.all()');
  assert.equal(page.run('collectionData.length'), 4);
  assert.equal(page.run('products.length'), 34);
  assert.ok(
    page.run('products.every(piece => Number.isInteger(piece.collection))'),
  );
  assert.equal(page.run('productById(7).id'), '07');
  assert.equal(page.run(`productById('07') === productById(7)`), true);
});

test('radarData.piece() loads details, or null for unknown ids', async () => {
  const page = loadScripts(CORE);
  const piece = await page.run(`radarData.piece('25')`);
  assert.equal(piece.id, '25');
  assert.equal(typeof piece.description, 'string');
  assert.ok(Array.isArray(piece.media));
  assert.equal(await page.run(`radarData.piece('99')`), null);
  assert.equal(await page.run(`radarData.piece('x1')`), null);
});

test('stress pieces are only added on development hosts', async () => {
  const live = loadScripts(CORE, { search: '?stress=10' });
  await live.run('radarData.all()');
  assert.equal(live.run('products.length'), 34);
  const local = loadScripts(CORE, {
    search: '?stress=10',
    hostname: 'localhost',
  });
  await local.run('radarData.all()');
  assert.equal(local.run('products.length'), 44);
  assert.equal(local.run('products[43].synthetic'), true);
});

test('art() uses AVIF/JPEG thumbnails, or the CDN for Shopify images', () => {
  const page = loadScripts(CORE);
  const local = page.run(
    `art({ id: '02', image: 'reference-02.png', title: 'A & B' })`,
  );
  assert.match(local, /^<picture><source type="image\/avif"/);
  assert.match(local, /assets\/thumbs\/reference-02-320\.jpg/);
  assert.match(local, /alt="A &amp; B"/);
  assert.match(local, /loading="lazy"/);
  const remote = page.run(
    `art({ id: '35', image: 'https://cdn.shopify.com/s/x.png?v=1', title: 'X' })`,
  );
  assert.match(remote, /^<img /);
  assert.match(remote, /width=320/);
  assert.equal(
    page.run(`cdnWidth('https://cdn.shopify.com/a.png?v=2', 640)`),
    'https://cdn.shopify.com/a.png?v=2&width=640',
  );
});

test('priceHtml() and productCard() show reduced prices and escape names', () => {
  const page = loadScripts(CORE);
  const full = { price: 2400, original: 2400 };
  const reducedPiece = { price: 1600, original: 2400 };
  assert.equal(page.run(`priceHtml(${JSON.stringify(full)})`), '₹2,400');
  assert.equal(
    page.run(`priceHtml(${JSON.stringify(reducedPiece)})`),
    '<del>₹2,400</del>₹1,600',
  );
  const card = page.run(
    `productCard({ id: '03', name: '<b>Bold</b> tee', title: 'T', ` +
      `image: 'reference-03.png', position: 2, price: 2400, ` +
      `original: 2400, dark: true })`,
  );
  assert.match(card, /href="product\.html\?id=03"/);
  assert.match(card, /&lt;b&gt;Bold&lt;\/b&gt; tee/);
  assert.match(card, /03 \/ SIGNAL/);
  assert.match(card, /WASHED BLACK \/ RELAXED SHAPE/);
});

test('radar maths: lag, glyphs, fade and dotted rings', () => {
  const page = loadScripts(CORE);
  const tau = Math.PI * 2;
  assert.equal(page.run('radar.lag(1, 1)'), 0);
  const behind = page.run('radar.lag(0, 0.5)');
  assert.ok(behind > 0 && behind < tau);
  assert.equal(page.run('radar.gridGlyph(0, 0)'), '+');
  assert.equal(page.run('radar.gridGlyph(16, 3)'), '|');
  assert.equal(page.run('radar.gridGlyph(3, -10)'), '-');
  assert.equal(page.run('radar.gridGlyph(3, 3)'), '');
  assert.equal(page.run('radar.sweepGlyph(0.9)'), '#');
  assert.equal(page.run('radar.sweepGlyph(0.5)'), '+');
  assert.equal(page.run('radar.sweepGlyph(0.2)'), ':');
  assert.equal(page.run('radar.sweepGlyph(0.1)'), '.');
  assert.equal(page.run('radar.fade(0)'), 0.08);
  assert.equal(page.run('radar.fade(5)'), 1);
  assert.match(page.run('radar.ringSvg(40)'), /pathLength="41"/);
  assert.match(page.run('radar.ringSvg(200, 140)'), /pathLength="140"/);
  assert.match(page.run('radar.ringSvg(40)'), /^<svg class="ring-svg" /);
});
