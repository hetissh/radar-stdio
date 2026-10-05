// Shared by every RADAR page: catalogue data loading, artwork, theme, concept bag and header menu.
//
// Loaded as a classic <script> before each page's own script, so every top-level name here is a global that
// the pages use (esc, art, money, radarData, productCard, bag, tones…). Rename one only together with its users.
// scripts/export.py inlines this file and finds it by the first line above: keep that line unchanged.
//
// Security: every catalogue value placed into HTML goes through esc(). Data comes from Shopify (merchant-entered)
// and the bag from localStorage, so neither may ever be treated as markup.

// ---------- Text and number formatting ----------

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
// Like esc(), but keeps intended line breaks.
const escLines = value => esc(value).replace(/\n/g, '<br>');
const pad = (n, size = 2) => String(n).padStart(size, '0');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const money = n => '₹' + n.toLocaleString('en-IN');

// ---------- Browser storage ----------
// Storage can be unavailable (private browsing, blocked cookies) and then throws when touched. These never throw:
// reads fall back to null and writes are skipped.

const STORAGE_KEYS = {
  bag: 'radar-bag',
  theme: 'radar-theme', // also read by the inline script in each page's <head>, before first paint
  stress: 'radar-stress',
  catalogue: 'radar-catalogue', // last catalogue view, for the product page's "← Catalogue" link
};

function safeStorage(area) {
  const store = () => window[area];
  return {
    get(key) {
      try {
        return store().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        store().setItem(key, value);
      } catch {}
    },
    remove(key) {
      try {
        store().removeItem(key);
      } catch {}
    },
  };
}
const localStore = safeStorage('localStorage');
const sessionStore = safeStorage('sessionStorage');

// ---------- Development tools (?stress, ?perf) ----------
// Only on local hosts and files opened from disk, never on the public site.

const isDevHost = loc =>
  loc.protocol === 'file:' ||
  ['localhost', '127.0.0.1', '[::1]', ''].includes(loc.hostname) ||
  loc.hostname.endsWith('.localhost');
const devTools = isDevHost(location);

// Stress test: ?stress=N (1–5000) adds N synthetic pieces for this tab's session; ?stress=0 turns it off.
// They reuse the supplied artwork, spread across the existing collections and take bearings from freeBearing().
const STRESS_MAX = 5000;
const STRESS_FIRST_ID = 35; // synthetic ids continue after the 34 supplied pieces
const stressCount = (() => {
  if (!devTools) {
    sessionStore.remove(STORAGE_KEYS.stress);
    return 0;
  }
  const requested = new URLSearchParams(location.search).get('stress');
  if (requested === null) return Number(sessionStore.get(STORAGE_KEYS.stress)) || 0;
  const n = Math.max(0, Math.min(STRESS_MAX, parseInt(requested, 10) || 0));
  if (n) sessionStore.set(STORAGE_KEYS.stress, n);
  else sessionStore.remove(STORAGE_KEYS.stress);
  return n;
})();

// Timings for stress tests: run radarPerf.report() in the console. Active only with ?stress or ?perf.
const radarPerf =
  devTools && (stressCount || new URLSearchParams(location.search).has('perf'))
    ? {
        stats: {},
        record(name, ms) {
          const s = this.stats[name] || (this.stats[name] = { count: 0, total: 0, max: 0, last: 0 });
          s.count++;
          s.total += ms;
          s.max = Math.max(s.max, ms);
          s.last = ms;
        },
        report() {
          const rows = {};
          for (const [name, s] of Object.entries(this.stats)) {
            rows[name] = { count: s.count, avgMs: +(s.total / s.count).toFixed(2), maxMs: +s.max.toFixed(2) };
          }
          const images = performance.getEntriesByType('resource').filter(r => r.initiatorType === 'img');
          const imageBytes = images.reduce((t, r) => t + (r.transferSize || r.encodedBodySize || 0), 0);
          rows['page elements'] = { count: document.getElementsByTagName('*').length };
          rows['images requested'] = { count: images.length, MB: +(imageBytes / 1048576).toFixed(1) };
          console.table(rows);
          return rows;
        },
      }
    : null;

if (radarPerf && window.PerformanceObserver && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) radarPerf.record('long task (>50ms)', entry.duration);
  }).observe({ type: 'longtask', buffered: true });
}

// ---------- Artwork ----------
// Supplied artwork uses thumbnails from scripts/build_images.py: AVIF where supported, JPEG otherwise, 320 or
// 640px wide by display size; the originals stay in assets/. A piece created in the Shopify admin has a
// cdn.shopify.com URL instead: the CDN resizes it by ?width= and picks AVIF or WebP itself, so it needs no
// <source> (see scripts/sync_shopify.py).

const remoteArt = src => /^https:\/\/cdn\.shopify\.com\//.test(src);
const cdnWidth = (url, width) => {
  const u = new URL(url);
  u.searchParams.set('width', width);
  return u.href;
};
const thumb = (piece, width, ext) =>
  remoteArt(piece.image)
    ? cdnWidth(piece.image, width)
    : `assets/thumbs/${piece.image.replace(/\.png$/, '')}-${width}.${ext}`;

// <picture> (or <img>) markup for a piece's artwork. Options: sizes (CSS width hint), className, eager.
function art(piece, { sizes = '160px', className = '', eager = piece.id === '01' } = {}) {
  const attrs =
    ` alt="${esc(piece.title)}"` +
    (className ? ` class="${className}"` : '') +
    ` loading="${eager ? 'eager' : 'lazy'}" decoding="async"`;
  // The portable export inlines one JPEG per image instead (see scripts/export.py).
  if (typeof assetUrls !== 'undefined') return `<img src="${assetUrls[piece.image]}"${attrs}>`;
  const srcset = ext => `${thumb(piece, 320, ext)} 320w, ${thumb(piece, 640, ext)} 640w`;
  if (remoteArt(piece.image)) {
    return `<img src="${esc(thumb(piece, 320))}" srcset="${esc(srcset())}" sizes="${sizes}"${attrs}>`;
  }
  return (
    `<picture><source type="image/avif" srcset="${srcset('avif')}" sizes="${sizes}">` +
    `<img src="${thumb(piece, 320, 'jpg')}" srcset="${srcset('jpg')}" sizes="${sizes}"${attrs}></picture>`
  );
}

// ---------- Bearings: where a piece sits on its collection's ring ----------
// A piece's coordinate: ring = its collection (R01–R04), bearing = its stored place around that ring.

const bearingOf = p => p.bearing;
const bearingLabel = p =>
  Number.isInteger(p.bearing) ? pad(p.bearing, 3) : p.bearing.toFixed(1).padStart(5, '0');

// The midpoint of the widest free gap on a ring: where a new piece should go. Also handy in the console.
function freeBearing(taken) {
  if (!taken.length) return 0;
  const sorted = [...taken].sort((a, b) => a - b);
  let widest = 0;
  let at = 0;
  sorted.forEach((bearing, i) => {
    const gap = (i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360) - bearing;
    if (gap > widest) {
      widest = gap;
      at = bearing + gap / 2;
    }
  });
  return Math.round((at % 360) * 10) / 10;
}

// ---------- Catalogue data ----------
// The catalogue lives in data/ (generated from data/products.json by scripts/build_data.py), and each page loads
// only what it needs: radarData.home() the homepage file, radarData.all() every summary (catalogue),
// radarData.piece(id) one piece in full plus its collection (product page). Until a loader resolves,
// collectionData and products are empty; page scripts start from the loader's promise.

let collectionData = [];
let products = [];
let productIndex = new Map();

// Resolves once the script has loaded or failed; the caller checks for what it should have defined.
const loadScript = src =>
  new Promise(resolve => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = script.onerror = resolve;
    document.head.append(script);
  });

async function getData(path) {
  const inline = () => window.radarInlineData?.[path];
  if (inline()) return inline();
  try {
    // no-cache revalidates with the server, so edited data shows up without version strings.
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) {
      throw Object.assign(new Error(path + ' ' + response.status), { status: response.status });
    }
    return await response.json();
  } catch (error) {
    // Opened from disk (file://), where fetch is blocked: load the bundled copy of every data file once.
    if (location.protocol === 'file:' && !window.radarInlineData) await loadScript('data/inline.js');
    if (inline()) return inline();
    throw error;
  }
}

// Like getData(), but a missing file (404) resolves to null. Any other failure still throws, so the page can
// offer a retry.
const getOptionalData = path =>
  getData(path).catch(error => {
    if (error.status === 404) return null;
    throw error;
  });

function useCatalogue({ collections, products: items }) {
  collectionData = collections.map(c => ({ ...c }));
  const ringOf = new Map(collectionData.map((c, ring) => [c.id, ring]));
  products = items.map(p => ({ ...p, collection: ringOf.get(p.collection) }));
  collectionData.forEach((c, ring) =>
    checkBearings(
      products.filter(p => p.collection === ring),
      ring,
    ),
  );
  if (stressCount) addStressPieces();
  productIndex = new Map(products.map(p => [p.id, p]));
  bag.fill();
  showStressBadge();
}

// Every piece should have a stored bearing. A missing one gets a temporary free spot; duplicates are flagged.
function checkBearings(pieces, ring) {
  const seen = new Set();
  for (const p of pieces) {
    if (p.bearing === undefined) {
      p.bearing = freeBearing(pieces.filter(q => q.bearing !== undefined).map(q => q.bearing));
      console.warn(
        `RADAR: piece ${p.id} has no stored bearing; using ${p.bearing}° for now. ` +
          'Add it to data/products.json so it stays put.',
      );
    }
    if (seen.has(p.bearing))
      console.warn(`RADAR: two pieces share bearing ${p.bearing}° on ring ${ring + 1}.`);
    seen.add(p.bearing);
  }
}

// Stress pieces copy the real ones (artwork, text) and append to each collection in turn.
function addStressPieces() {
  const real = products.slice();
  const taken = collectionData.map((c, ring) =>
    products.filter(p => p.collection === ring).map(p => p.bearing),
  );
  for (let n = 0; n < stressCount; n++) {
    const ring = n % collectionData.length;
    const base = real[n % real.length];
    const id = String(STRESS_FIRST_ID + n);
    const position = collectionData[ring].count;
    const original = 2200 + (position % 3) * 200;
    const bearing = freeBearing(taken[ring]);
    taken[ring].push(bearing);
    collectionData[ring].count++;
    products.push({
      ...base,
      id,
      base: base.id,
      title: `${base.title} / variant ${n + 1}`,
      name: `Signal ${id} tee`,
      collection: ring,
      position,
      original,
      price:
        collectionData[ring].id === 'end-of-season' ? Math.round((original * 0.65) / 100) * 100 : original,
      dark: position % 3 === 1,
      bearing,
      synthetic: true,
    });
  }
}

const radarData = {
  async home() {
    if (stressCount) return this.all();
    useCatalogue(await getData('data/home.json'));
  },

  async all() {
    useCatalogue(await getData('data/index.json'));
  },

  // Returns the piece with its description and status, or null if there is no such piece.
  async piece(id) {
    const key = pad(id);
    if (stressCount) {
      await this.all();
      const p = productById(key);
      if (!p) return null;
      const detail = await getOptionalData(`data/pieces/${p.base || p.id}.json`);
      return Object.assign(p, {
        description: detail ? detail.description : '',
        status: detail ? detail.status : '',
        media: detail && !p.synthetic ? detail.media : undefined,
      });
    }
    if (!/^\d+$/.test(key)) return null;
    const detail = await getOptionalData(`data/pieces/${key}.json`);
    if (!detail) return null;
    useCatalogue(await getData(`data/collections/${detail.collection}.json`));
    return Object.assign(productById(key), {
      description: detail.description,
      status: detail.status,
      media: detail.media,
    });
  },
};

// Shown in place of content when catalogue data can't be loaded (offline, server error): explains and offers
// a retry.
function showLoadError(container, what) {
  console.error('RADAR: could not load ' + what + '.');
  container.insertAdjacentHTML(
    'beforeend',
    '<section class="load-error" role="alert"><span class="mono muted">Signal interrupted</span>' +
      `<h2>We couldn’t load ${esc(what)}.</h2><p>Check your connection and try again.</p>` +
      '<button type="button" class="load-retry mono">Retry ↻</button></section>',
  );
  container.querySelector('.load-retry').addEventListener('click', () => location.reload());
}

// ---------- Pieces: lookups, labels and the product card ----------

const productUrl = p => 'product.html?id=' + encodeURIComponent(p.id);
const productById = id => productIndex.get(pad(id));
// Reduced pieces carry an original price above their price.
const reduced = p => p.original > p.price;
const priceHtml = p => (reduced(p) ? `<del>${money(p.original)}</del>` : '') + money(p.price);
const colourOf = p => (p.dark ? 'Washed black' : 'Chalk');

function productCard(p) {
  return (
    `<a class="product-card" data-product="${p.id}" href="${productUrl(p)}" aria-label="View ${esc(p.name)}">` +
    `<div class="garment-space"><span class="signal-tag">${pad(p.position + 1)} / SIGNAL</span>` +
    `<div class="concept-tee ${p.dark ? 'dark' : ''}">${art(p)}</div></div>` +
    `<div class="piece-caption"><span>${esc(p.name)}</span><span class="mono">${priceHtml(p)}</span></div>` +
    `<div class="piece-meta">${colourOf(p).toUpperCase()} / RELAXED SHAPE</div></a>`
  );
}

// ---------- Theme ----------
// Canvas marks are tones measured from the page colour, so one scale serves both themes:
// tones[0] is the page colour and tones[255] the strongest contrast against it.

const page = document.documentElement;
let tones = [];
let echoInk = '';

function applyTheme(theme) {
  const light = theme === 'light';
  const paper = light ? [243, 242, 238] : [0, 0, 0];
  const step = light ? -1 : 1;
  page.dataset.theme = theme;
  tones = Array.from(
    { length: 256 },
    (_, v) => 'rgb(' + paper.map(c => Math.max(0, c + step * v)).join(',') + ')',
  );
  echoInk = light ? '93,92,88' : '150,150,150';
  document.querySelectorAll('.theme-toggle').forEach(button => {
    button.textContent = light ? 'DARK' : 'LIGHT';
    button.setAttribute('aria-label', 'Switch to ' + (light ? 'dark' : 'light') + ' mode');
  });
}

applyTheme(page.dataset.theme === 'light' ? 'light' : 'dark');
document.querySelectorAll('.theme-toggle').forEach(button =>
  button.addEventListener('click', () => {
    const theme = page.dataset.theme === 'light' ? 'dark' : 'light';
    localStore.set(STORAGE_KEYS.theme, theme);
    applyTheme(theme);
    // Canvases repaint on this event with the new tones.
    document.dispatchEvent(new Event('radar:theme'));
  }),
);

// ---------- Concept bag ----------
// Persists across pages (and tabs) in localStorage. Checkout is not connected.

// Saved bag lines, dropping anything malformed.
function parseBag(json) {
  try {
    return (JSON.parse(json) || []).filter(item => item && item.id && item.qty > 0);
  } catch {
    return [];
  }
}

const bag = {
  items: parseBag(localStore.get(STORAGE_KEYS.bag)),

  save() {
    localStore.set(STORAGE_KEYS.bag, JSON.stringify(this.items));
    renderBag();
  },

  // Each line keeps the name and price from when it was added, like a real basket.
  add(p, size) {
    const item = this.items.find(i => i.id === p.id && i.size === size);
    if (item) item.qty++;
    else this.items.push({ id: p.id, size, qty: 1, name: p.name, price: p.price });
    this.save();
  },

  change(index, step) {
    const item = this.items[index];
    item.qty += step;
    if (item.qty < 1) this.items.splice(index, 1);
    this.save();
  },

  count() {
    return this.items.reduce((n, item) => n + item.qty, 0);
  },

  // Lines saved before snapshots existed get their name and price once the piece's data is loaded.
  fill() {
    let changed = false;
    for (const item of this.items) {
      const p = productById(item.id);
      if (p && (!item.name || item.price === undefined)) {
        item.name = p.name;
        item.price = p.price;
        changed = true;
      }
    }
    if (changed) this.save();
  },
};

const bagDialog = document.querySelector('#bag');

function bagRow(item, index) {
  const name = item.name || 'Piece ' + item.id;
  const label = `${esc(name)}, size ${esc(item.size)}`;
  return (
    `<div class="bag-row"><a href="${productUrl(item)}">${esc(name)}</a>` +
    `<span class="mono bag-size">Size ${esc(item.size)}</span>` +
    `<span class="bag-qty"><button data-bag="${index}" data-step="-1" aria-label="Remove one ${label}">−</button>` +
    `<span class="mono">${pad(item.qty)}</span>` +
    `<button data-bag="${index}" data-step="1" aria-label="Add one ${label}">+</button></span>` +
    `<span class="mono">${item.price === undefined ? '—' : money(item.price * item.qty)}</span></div>`
  );
}

function renderBag() {
  const count = pad(bag.count());
  document.querySelectorAll('.bag-count').forEach(el => (el.textContent = count));
  const list = bagDialog.querySelector('.bag-items');
  if (!bag.items.length) {
    list.innerHTML = '<p>Your concept bag is empty.</p>';
    return;
  }
  const total = bag.items.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
  list.innerHTML =
    bag.items.map(bagRow).join('') +
    `<div class="bag-total mono"><span>Total / ${count} pieces</span><span>${money(total)}</span></div>`;
}

bagDialog.querySelector('.bag-items').addEventListener('click', event => {
  const button = event.target.closest('[data-step]');
  if (!button) return;
  const index = Number(button.dataset.bag);
  const step = Number(button.dataset.step);
  bag.change(index, step);
  // Keep keyboard focus on the same control after the list re-renders.
  const same = bagDialog.querySelector(`[data-bag="${index}"][data-step="${step}"]`);
  (same || bagDialog.querySelector('.bag-close')).focus();
});
document.querySelectorAll('.bag-open').forEach(button =>
  button.addEventListener('click', () => {
    renderBag();
    bagDialog.showModal();
    document.body.classList.add('locked');
  }),
);
document.querySelector('.bag-close').addEventListener('click', () => bagDialog.close());
bagDialog.addEventListener('close', () => document.body.classList.remove('locked'));
// Another tab changed the bag.
addEventListener('storage', event => {
  if (event.key !== STORAGE_KEYS.bag) return;
  bag.items = parseBag(event.newValue);
  renderBag();
});
renderBag();

// ---------- Header menu (small screens) ----------

const menu = document.querySelector('.menu-button');
const nav = document.querySelector('.nav');

function setMenu(open) {
  menu.setAttribute('aria-expanded', String(open));
  menu.textContent = open ? 'Close −' : 'Menu +';
  nav.classList.toggle('open', open);
}
function closeMenu() {
  setMenu(false);
}

menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
nav.querySelectorAll('a, button').forEach(el => el.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenu();
});

// ---------- Page transitions ----------

// Name only the clicked garment, so it alone morphs into the next page's stage.
document.addEventListener('click', event => {
  const card = event.target.closest('.product-card');
  if (!card || event.defaultPrevented) return;
  document.querySelectorAll('.tee-view, .product-card .concept-tee').forEach(el => {
    el.style.viewTransitionName = 'none';
  });
  const tee = card.querySelector('.concept-tee');
  if (tee) tee.style.viewTransitionName = 'piece';
});
// Coming back (including from the back/forward cache) resets the names for the next navigation.
addEventListener('pageshow', () =>
  document.querySelectorAll('.tee-view, .product-card .concept-tee, [data-morph]').forEach(el => {
    el.style.viewTransitionName = '';
  }),
);
// A skipped page transition (hidden tab, rapid navigation) is harmless; keep it out of the error console.
for (const type of ['pageswap', 'pagereveal']) {
  addEventListener(type, event => {
    const transition = event.viewTransition;
    if (!transition) return;
    for (const promise of [transition.ready, transition.finished, transition.updateCallbackDone]) {
      promise?.catch(() => {});
    }
  });
}

// ---------- Stress-test badge ----------

// A visible marker so stress-test data is never mistaken for the real catalogue.
function showStressBadge() {
  if (!stressCount || document.querySelector('.stress-badge')) return;
  const total = collectionData.reduce((n, c) => n + c.count, 0);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="stress-badge" role="status">Stress test · ${total.toLocaleString('en-IN')} pieces ` +
      '<button type="button">Exit</button></div>',
  );
  document.querySelector('.stress-badge button').addEventListener('click', () => {
    sessionStore.remove(STORAGE_KEYS.stress);
    const query = new URLSearchParams(location.search);
    query.delete('stress');
    location.search = query.toString();
  });
}
