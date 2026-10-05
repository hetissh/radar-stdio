/**
 * @fileoverview Tests for the catalogue's state: reading the URL, filtering,
 * sorting and searching, and writing the URL back.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts, CORE } = require('../helpers/browser.js');

/**
 * A page with the real catalogue loaded and a state created from `search`.
 * @param {string} search
 * @return {!Promise<{run: function(string): *}>}
 */
async function catalogueWith(search) {
  const page = loadScripts([...CORE, 'catalogue/catalogue-state.js']);
  await page.run('radarData.all()');
  page.run(`var catalogue = catalogueState.create(${JSON.stringify(search)})`);
  return page;
}

test('an empty URL gives the defaults and every piece', async () => {
  const page = await catalogueWith('');
  assert.deepEqual(
    { ...page.run('catalogue.state') },
    {
      view: 'grid',
      collection: 'all',
      colour: 'all',
      artwork: 'all',
      sort: 'orbit',
      q: '',
      ring: '',
    },
  );
  assert.equal(page.run('catalogue.inRange().length'), 34);
  assert.equal(page.run('catalogue.toQuery()'), '');
  assert.equal(page.run('catalogue.activeFilterCount()'), 0);
});

test('known URL values are read; unknown ones are ignored', async () => {
  const page = await catalogueWith(
    '?view=index&collection=tees&colour=black&sort=bogus&ring=nowhere',
  );
  const state = page.run('catalogue.state');
  assert.equal(state.view, 'index');
  assert.equal(state.collection, 'tees');
  assert.equal(state.colour, 'black');
  assert.equal(state.sort, 'orbit');
  assert.equal(state.ring, '');
  assert.equal(page.run('catalogue.activeFilterCount()'), 2);
});

test('the search is trimmed and limited to 60 characters', async () => {
  const long = 'x'.repeat(80);
  const page = await catalogueWith(`?q=${long}`);
  assert.equal(page.run('catalogue.state.q').length, 60);
});

test('filters and search narrow the pieces in range', async () => {
  const page = await catalogueWith('?collection=tees&colour=black');
  const pieces = page.run('catalogue.inRange()');
  assert.ok(pieces.length > 0 && pieces.length < 34);
  assert.ok(
    page.run(`catalogue.inRange().every(piece =>
      collectionData[piece.collection].id === 'tees' && piece.dark)`),
  );
  const none = await catalogueWith('?q=zzzz');
  assert.equal(none.run('catalogue.inRange().length'), 0);
});

test('search ignores accents and case, and needs every word', async () => {
  const page = await catalogueWith('');
  const name = page.run('products[0].name');
  const firstWord = name.split(' ')[0].toUpperCase();
  page.run(`catalogue.state.q = ${JSON.stringify(firstWord)}`);
  assert.ok(page.run('catalogue.inRange().length') >= 1);
  page.run(`catalogue.state.q = ${JSON.stringify(`${firstWord} zzzz`)}`);
  assert.equal(page.run('catalogue.inRange().length'), 0);
});

test('sorts order by price, name or orbit', async () => {
  const page = await catalogueWith('?sort=price-up');
  const prices = page.run('catalogue.inRange().map(piece => piece.price)');
  assert.deepEqual(
    prices,
    [...prices].sort((a, b) => a - b),
  );
  page.run(`catalogue.state.sort = 'name'`);
  const names = page.run('catalogue.inRange().map(piece => piece.name)');
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  page.run(`catalogue.state.sort = 'orbit'`);
  const rings = page.run('catalogue.inRange().map(piece => piece.collection)');
  assert.deepEqual(
    rings,
    [...rings].sort((a, b) => a - b),
  );
});

test('toQuery() writes only what differs from the defaults', async () => {
  const page = await catalogueWith('?view=field&q=tee&sort=orbit');
  assert.equal(page.run('catalogue.toQuery()'), 'view=field&q=tee');
});

test('clearFilters() resets filters and search, not view or sort', async () => {
  const page = await catalogueWith('?view=index&sort=name&collection=tees&q=a');
  page.run('catalogue.clearFilters()');
  assert.equal(page.run('catalogue.toQuery()'), 'view=index&sort=name');
});

test('the returning piece comes from ?piece=', async () => {
  const page = await catalogueWith('?piece=7');
  assert.equal(page.run('catalogue.returning.id'), '07');
  const none = await catalogueWith('');
  assert.equal(none.run('catalogue.returning'), undefined);
});
