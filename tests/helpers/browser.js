/**
 * @fileoverview Runs the site's classic browser scripts in a Node `vm`
 * context with just enough of a browser for them to load: a document whose
 * elements accept any call, working localStorage/sessionStorage, a location,
 * and fetch() reading files from public/. Scripts share one global scope, as
 * they do in a page, so later scripts see earlier ones' globals.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', '..', 'public');

/**
 * A stand-in DOM element: every property is another stand-in, every call
 * succeeds, and assigned values are kept.
 * @param {string} name For debugging.
 * @return {!Object}
 */
function fakeElement(name) {
  const target = function () {};
  target.dataset = {};
  target.style = {};
  target.classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };
  return new Proxy(target, {
    /**
     * @param {!Object} object
     * @param {string|symbol} key
     * @return {*} A kept value, a query helper, or another stand-in.
     */
    get(object, key) {
      if (key in object) return object[key];
      if (key === 'querySelectorAll') return () => [];
      if (key === 'querySelector') return selector => fakeElement(selector);
      if (key === Symbol.toPrimitive) return () => name;
      return fakeElement(`${name}.${String(key)}`);
    },
    /**
     * @param {!Object} object
     * @param {string|symbol} key
     * @param {*} value
     * @return {boolean}
     */
    set(object, key, value) {
      object[key] = value;
      return true;
    },
  });
}

/**
 * A working Storage, optionally one that throws on every call (as browsers
 * do when storage is blocked).
 * @param {boolean=} broken
 * @return {!Object}
 */
function fakeStorage(broken = false) {
  const data = new Map();
  const guard = () => {
    if (broken) throw new Error('SecurityError: storage is blocked');
  };
  return {
    getItem: key => (guard(), data.has(key) ? data.get(key) : null),
    setItem: (key, value) => (guard(), data.set(key, String(value))),
    removeItem: key => (guard(), data.delete(key)),
  };
}

/**
 * A fetch() that serves files from public/, or 404.
 * @param {string} url Relative to the site root.
 * @return {!Promise<!Object>}
 */
async function fakeFetch(url) {
  const file = path.join(PUBLIC, url);
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  const text = fs.readFileSync(file, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

/**
 * Loads browser scripts into a fresh context.
 * @param {!Array<string>} scripts Paths relative to public/js/.
 * @param {{search: (string|undefined), hostname: (string|undefined),
 *     brokenStorage: (boolean|undefined)}=} options
 * @return {{run: function(string): *}} run() evaluates code in the context.
 */
function loadScripts(scripts, options = {}) {
  const { search = '', hostname = 'radar.example', brokenStorage } = options;
  const context = {
    console: { warn: () => {}, error: () => {}, table: () => {} },
    document: fakeElement('document'),
    location: { protocol: 'https:', hostname, search, pathname: '/' },
    localStorage: fakeStorage(brokenStorage),
    sessionStorage: fakeStorage(brokenStorage),
    URL,
    URLSearchParams,
    Promise,
    Event: class FakeEvent {},
    addEventListener: () => {},
    performance: { now: () => 0, getEntriesByType: () => [] },
    fetch: fakeFetch,
  };
  context.window = context;
  vm.createContext(context);
  for (const script of scripts) {
    const file = path.join(PUBLIC, 'js', script);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  return { run: code => vm.runInContext(code, context) };
}

/** Every core script, in page order. */
const CORE = [
  'core/format.js',
  'core/storage.js',
  'core/dev-tools.js',
  'core/data.js',
  'core/artwork.js',
  'core/pieces.js',
  'core/theme.js',
  'core/bag.js',
  'core/navigation.js',
  'core/radar.js',
];

module.exports = { loadScripts, CORE };
