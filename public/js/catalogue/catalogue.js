// Catalogue page: every piece in three views, with filters, sort and search mirrored in the URL.
//   grid  – product cards, rendered in batches as you scroll
//   index – a compact table of the same pieces, with a sweep line passing down it
//   field – every piece on one radar (catalogue-field.js)
// Catalogue data, theme, concept bag and header menu come from shared.js.
(async () => {
  const buildStart = performance.now();
  const main = document.querySelector('#catalogue');
  // Every piece's summary (no long text): data/index.json.
  try {
    await radarData.all();
  } catch (error) {
    console.error(error);
    showLoadError(main, 'the catalogue');
    return;
  }
  radarPerf?.record('catalogue data', performance.now() - buildStart);

  const GRID_BATCH = 48;
  const INDEX_BATCH = 120;
  const SEARCH_MAX = 60; // characters
  const LOAD_AHEAD_PX = 600; // start loading the next batch this far before the "Show more" row is reached

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const slug = s =>
    s
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  // Lowercase without accents, so a search for "cafe" finds "Café".
  const fold = s =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const collectionOf = p => collectionData[p.collection];
  const coord = p => `R${pad(p.collection + 1)} / ${bearingLabel(p)}°`;
  const linkFor = p => `${productUrl(p)}&from=catalogue`;

  // ---------- State: filters, sort, search and view, mirrored in the URL ----------

  const groups = {
    collection: {
      label: 'Collection',
      options: [['all', 'All'], ...collectionData.map(c => [c.id, c.title])],
    },
    colour: {
      label: 'Colour',
      options: [
        ['all', 'All'],
        ['chalk', 'Chalk'],
        ['black', 'Washed black'],
      ],
    },
    artwork: {
      label: 'Artwork',
      options: [
        ['all', 'All'],
        ...[...new Set(products.map(p => p.category))].map(c => [slug(c), c]),
      ],
    },
  };
  const sorts = [
    ['orbit', 'Orbit'],
    ['price-up', 'Price ↑'],
    ['price-down', 'Price ↓'],
    ['name', 'Name'],
  ];
  const views = ['field', 'grid', 'index'];
  const defaults = {
    view: 'grid',
    collection: 'all',
    colour: 'all',
    artwork: 'all',
    sort: 'orbit',
    q: '',
    ring: '',
  };

  // Only known values are taken from the URL.
  const state = { ...defaults };
  const params = new URLSearchParams(location.search);
  const isOption = (options, value) => options.some(([v]) => v === value);
  for (const [key, group] of Object.entries(groups)) {
    if (isOption(group.options, params.get(key))) state[key] = params.get(key);
  }
  if (views.includes(params.get('view'))) state.view = params.get('view');
  if (isOption(sorts, params.get('sort'))) state.sort = params.get('sort');
  state.q = (params.get('q') || '').trim().slice(0, SEARCH_MAX);
  if (collectionData.some(c => c.id === params.get('ring'))) {
    state.ring = params.get('ring');
  }
  // Set when coming back from a product page.
  const returning = productById(params.get('piece') || '');

  // Search matches every word against a piece's names, discipline, category, collection and colour.
  const haystack = new Map(
    products.map(p => [
      p,
      fold(
        [
          p.name,
          p.title,
          p.discipline,
          p.category,
          collectionOf(p).title,
          colourOf(p),
        ].join(' '),
      ),
    ]),
  );
  const matches = (p, words) =>
    (state.collection === 'all' || collectionOf(p).id === state.collection) &&
    (state.colour === 'all' || (state.colour === 'black') === p.dark) &&
    (state.artwork === 'all' || slug(p.category) === state.artwork) &&
    words.every(word => haystack.get(p).includes(word));
  // Orbit order: ring by ring, then clockwise by stored bearing.
  const byOrbit = (a, b) =>
    a.collection - b.collection ||
    a.bearing - b.bearing ||
    a.position - b.position;
  const order = {
    'orbit': byOrbit,
    'price-up': (a, b) => a.price - b.price || byOrbit(a, b),
    'price-down': (a, b) => b.price - a.price || byOrbit(a, b),
    'name': (a, b) => a.name.localeCompare(b.name),
  };

  // ---------- Markup ----------

  const chip = (group, value, label) =>
    `<button class="chip" data-group="${group}" data-value="${value}" aria-pressed="false">${esc(label)}</button>`;

  const filtersHtml = `<div class="filters" id="filters">${Object.entries(
    groups,
  )
    .map(
      ([key, group]) =>
        `<div class="filter-row" role="group" aria-labelledby="filter-${key}">` +
        `<span class="filter-label" id="filter-${key}">${esc(group.label)}</span>${group.options
          .map(([value, label]) => chip(key, value, label))
          .join('')}</div>`,
    )
    .join('')}</div>`;

  const toolbarHtml =
    `<div class="toolbar">` +
    `<button class="filter-toggle" aria-expanded="false" aria-controls="filters">Filter +</button>` +
    `<div class="sort-row" role="group" aria-labelledby="sort-label"><span class="filter-label" id="sort-label">Sort</span>${sorts
      .map(([value, label]) => chip('sort', value, label))
      .join('')}</div>` +
    `<label class="search"><span class="visually-hidden">Search the catalogue</span>` +
    `<input type="search" placeholder="Search" autocomplete="off" spellcheck="false" maxlength="${SEARCH_MAX}">` +
    `<kbd aria-hidden="true">/</kbd></label>` +
    `<p class="result-count" aria-hidden="true"></p><p class="visually-hidden" aria-live="polite" id="result-status"></p>` +
    `<button class="clear-filters" hidden>Clear ×</button>` +
    `<div class="view-switch" role="group" aria-label="View">${views
      .map(view => chip('view', view, view))
      .join('<span aria-hidden="true">/</span>')}</div></div>`;

  const indexHtml =
    '<section class="catalogue-index" aria-label="Catalogue index"><div class="index-head" aria-hidden="true">' +
    '<span>No.</span><span>Piece</span><span>Collection</span><span>Colour</span><span>Artwork</span>' +
    '<span>Coordinate</span><span>Price</span></div>' +
    '<ol class="index-list"></ol><div class="index-sweep" aria-hidden="true"></div></section>';

  document.querySelector('.catalogue-kicker').textContent =
    `${products.length} pieces / ${collectionData.length} collections`;
  main.insertAdjacentHTML(
    'beforeend',
    `${
      filtersHtml + toolbarHtml
    }<section class="catalogue-grid" aria-label="Catalogue grid"></section>${
      indexHtml
    }<div class="load-more-row" hidden><span class="shown-count"></span><button class="load-more">Show more ↓</button></div>${catalogueField.markup()}<div class="empty-state" hidden><span class="mono muted">No signal</span>` +
      `<p>Nothing in range for these filters.</p><button class="clear-filters">Clear filters ×</button></div>`,
  );

  const grid = main.querySelector('.catalogue-grid');
  const indexSection = main.querySelector('.catalogue-index');
  const indexList = main.querySelector('.index-list');
  const fieldView = main.querySelector('.field-view');
  const toolbar = main.querySelector('.toolbar');
  const filtersEl = main.querySelector('#filters');
  const search = toolbar.querySelector('input');
  const count = toolbar.querySelector('.result-count');
  const status = toolbar.querySelector('#result-status');
  const filterToggle = toolbar.querySelector('.filter-toggle');
  const empty = main.querySelector('.empty-state');
  const moreRow = main.querySelector('.load-more-row');
  const moreButton = moreRow.querySelector('.load-more');
  const sections = { grid, index: indexSection, field: fieldView };

  // Cards and rows are created on first use and cached, so a view costs nothing until it is shown.
  const tpl = document.createElement('template');
  const cards = new Map();
  const rows = new Map();
  /**
   *
   * @param p
   */
  function cardFor(p) {
    let el = cards.get(p);
    if (!el) {
      tpl.innerHTML = productCard(p);
      el = tpl.content.firstElementChild;
      el.href = linkFor(p);
      el.querySelector('.signal-tag').textContent = coord(p);
      cards.set(p, el);
    }
    return el;
  }
  /**
   *
   * @param p
   */
  function rowFor(p) {
    let el = rows.get(p);
    if (!el) {
      const collection = esc(collectionOf(p).title);
      const label =
        `${esc(p.name)}, number ${p.id}, ${collection}, ${colourOf(p)}, ${esc(p.category)}, ` +
        `${coord(p).replace('°', ' degrees')}, ${money(p.price)}`;
      tpl.innerHTML =
        `<li data-product="${p.id}"><a class="index-row" href="${linkFor(p)}" aria-label="${label}">` +
        `<span class="index-no">${p.id}</span><span class="index-name">${esc(p.name)}</span>` +
        `<span>${collection}</span><span>${colourOf(p)}</span><span>${esc(p.category)}</span>` +
        `<span class="index-coord">${coord(p)}</span><span class="index-price">${priceHtml(p)}</span></a></li>`;
      el = tpl.content.firstElementChild;
      rows.set(p, el);
    }
    return el;
  }

  // ---------- Applying state ----------

  let visible = new Set(products); // pieces in range
  let currentList = products; // pieces in range, sorted
  let limit = GRID_BATCH; // how many of currentList the grid or index shows
  let statusTimer = 0;
  let urlTimer = 0;
  const batchSize = () => (state.view === 'index' ? INDEX_BATCH : GRID_BATCH);

  const field = catalogueField.mount({
    section: fieldView,
    state,
    motion,
    coord,
    linkFor,
    byOrbit,
    getList: () => currentList,
    isVisible: p => visible.has(p),
    apply,
  });

  /**
   *
   */
  function writeUrl() {
    const query = new URLSearchParams();
    for (const key of Object.keys(defaults)) {
      if (state[key] !== defaults[key]) query.set(key, state[key]);
    }
    const search = query.toString();
    history.replaceState(
      null,
      '',
      location.pathname + (search ? `?${search}` : ''),
    );
    // The product page reads this to send "← Catalogue" back to the same view and filters.
    sessionStore.set(STORAGE_KEYS.catalogue, search);
  }

  // Render the grid or index from `from` up to the current limit (from 0 replaces the list).
  /**
   *
   * @param from
   */
  function renderList(from) {
    const isGrid = state.view === 'grid';
    const container = isGrid ? grid : indexList;
    const els = currentList.slice(from, limit).map(isGrid ? cardFor : rowFor);
    els.forEach(el => el.classList.remove('arriving'));
    if (from) container.append(...els);
    else container.replaceChildren(...els);
    updateMoreRow();
    return els;
  }

  /**
   *
   */
  function updateMoreRow() {
    const shown = Math.min(limit, currentList.length);
    moreRow.hidden = state.view === 'field' || shown >= currentList.length;
    moreRow.querySelector('.shown-count').textContent =
      `Showing ${shown} of ${currentList.length}`;
  }

  // Fade in only the first items of a batch, with a single layout for the whole batch (not one per element).
  /**
   *
   * @param els
   */
  function animateIn(els) {
    if (motion.matches || !els.length) return;
    void main.offsetWidth;
    els.slice(0, 24).forEach((el, i) => {
      el.style.animationDelay = `${Math.min(i, 14) * 22}ms`;
      el.classList.add('arriving');
    });
  }
  main.addEventListener('animationend', event => {
    if (
      event.target.classList.contains('arriving') &&
      !event.target.closest('.contact')
    ) {
      event.target.classList.remove('arriving');
    }
  });

  // Options: animate (fade the new list in), typing (debounce the URL and announcement while the visitor
  // types), keepLimit (keep the number of items already shown).
  /**
   *
   * @param root0
   * @param root0.animate
   * @param root0.typing
   * @param root0.keepLimit
   */
  function apply({ animate = false, typing = false, keepLimit = false } = {}) {
    const applyStart = performance.now();
    const words = fold(state.q).split(/\s+/).filter(Boolean);
    currentList = products
      .filter(p => matches(p, words))
      .sort(order[state.sort]);
    const list = currentList;
    visible = new Set(list);
    if (!keepLimit) limit = batchSize();
    if (state.view === 'field') field.render();
    else {
      const els = renderList(0);
      if (animate) animateIn(els);
    }
    updateMoreRow();
    renderControls(list);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(
      () => {
        status.textContent = list.length
          ? `${list.length} of ${products.length} pieces in range`
          : 'No pieces match these filters';
      },
      typing ? 600 : 50,
    );
    if (state.view === 'field') field.updateContact();
    clearTimeout(urlTimer);
    urlTimer = setTimeout(writeUrl, typing ? 300 : 0);
    field.sync();
    radarPerf?.record('catalogue apply', performance.now() - applyStart);
  }

  // Chips, visible sections, counts and the filter toggle, for the list now in range.
  /**
   *
   * @param list
   */
  function renderControls(list) {
    main.querySelectorAll('.chip').forEach(c => {
      c.setAttribute(
        'aria-pressed',
        String(state[c.dataset.group] === c.dataset.value),
      );
    });
    for (const [view, el] of Object.entries(sections)) {
      el.hidden = state.view !== view || (view !== 'field' && !list.length);
    }
    empty.hidden = !!list.length || state.view === 'field';
    toolbar.querySelector('.sort-row').hidden = state.view === 'field';
    const active =
      ['collection', 'colour', 'artwork'].filter(k => state[k] !== 'all')
        .length + (state.q ? 1 : 0);
    toolbar.querySelector('.clear-filters').hidden = !active;
    filterToggle.textContent = `Filter ${
      filtersEl.classList.contains('open') ? '−' : '+'
    }${active ? ` (${active})` : ''}`;
    count.textContent = list.length
      ? `${pad(list.length)} of ${products.length} in range`
      : 'No signal';
  }

  /**
   *
   * @param focusFirst
   */
  function loadMore(focusFirst) {
    if (state.view === 'field' || limit >= currentList.length) return;
    const from = limit;
    limit += batchSize();
    const els = renderList(from);
    animateIn(els);
    // Keyboard users continue from the first new item rather than back at the button.
    if (focusFirst && els[0]) {
      (els[0].matches('a') ? els[0] : els[0].querySelector('a')).focus({
        preventScroll: true,
      });
    }
  }

  // ---------- Controls ----------

  moreButton.addEventListener('click', () => loadMore(true));
  new IntersectionObserver(
    entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      loadMore(false);
      // A tall screen may still show the row after one batch; keep going until it is out of reach.
      requestAnimationFrame(() => {
        if (
          !moreRow.hidden &&
          moreRow.getBoundingClientRect().top < innerHeight + LOAD_AHEAD_PX
        ) {
          loadMore(false);
        }
      });
    },
    { rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px` },
  ).observe(moreRow);

  main.addEventListener('click', event => {
    const c = event.target.closest('.chip');
    if (c) {
      const { group, value } = c.dataset;
      if (state[group] === value) return;
      state[group] = value;
      apply({ animate: true });
      return;
    }
    if (event.target.closest('.clear-filters')) {
      Object.assign(state, {
        collection: 'all',
        colour: 'all',
        artwork: 'all',
        q: '',
      });
      search.value = '';
      apply({ animate: true });
    }
  });

  search.value = state.q;
  search.addEventListener('input', () => {
    state.q = search.value.trim();
    apply({ typing: true });
  });
  // "/" jumps to search from anywhere outside a text field.
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.target.closest('input,textarea,select,[contenteditable]')) return;
    event.preventDefault();
    search.focus();
    search.select();
  });

  filterToggle.addEventListener('click', () => {
    const open = !filtersEl.classList.contains('open');
    filtersEl.classList.toggle('open', open);
    filterToggle.setAttribute('aria-expanded', String(open));
    apply();
    // The toolbar may be pinned far down the page; bring the opened panel into view beneath it.
    if (open) {
      const top =
        filtersEl.getBoundingClientRect().top +
        scrollY -
        toolbar.offsetHeight -
        4;
      if (top < scrollY) {
        scrollTo({ top, behavior: motion.matches ? 'instant' : 'smooth' });
      }
    }
  });

  // ---------- Index: a sweep line passes down the rows ----------

  const sweep = indexSection.querySelector('.index-sweep');
  new ResizeObserver(() => {
    sweep.style.setProperty('--top', `${indexList.offsetTop}px`);
    sweep.style.setProperty('--h', `${indexList.offsetHeight}px`);
    sweep.style.animationDuration = `${Math.max(4, indexList.offsetHeight / 220).toFixed(1)}s`;
  }).observe(indexList);

  // ---------- First render, and landing back on a piece from its product page ----------

  /**
   *
   * @param piece
   */
  function landOn(piece) {
    if (!visible.has(piece)) return;
    if (state.view === 'field') {
      // The piece may not be plotted at this level of detail: zoom into its ring.
      if (!field.includes(piece)) {
        state.ring = collectionOf(piece).id;
        apply();
      }
      if (!field.includes(piece)) return;
      // Select explicitly: focus events do not fire when the window itself is not focused yet.
      field.select(piece);
    } else {
      // Make sure the piece's batch is rendered before scrolling to it.
      const i = currentList.indexOf(piece);
      if (i >= limit) {
        limit = Math.ceil((i + 1) / batchSize()) * batchSize();
        renderList(0);
      }
    }
    const target =
      state.view === 'field'
        ? field.blipFor(piece)
        : state.view === 'index'
          ? rowFor(piece).querySelector('a')
          : cardFor(piece);
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    target.focus({ preventScroll: true });
    target.classList.add('returned');
  }

  apply();
  if (returning) landOn(returning);
  radarPerf?.record('catalogue build', performance.now() - buildStart);
})();
