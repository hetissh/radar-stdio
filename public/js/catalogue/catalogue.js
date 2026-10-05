/**
 * @fileoverview The catalogue page: every piece in three views, with filters,
 * sort and search mirrored in the URL.
 * - grid: product cards, rendered in batches as you scroll.
 * - index: a compact table of the same pieces, with a sweep line passing
 *   down it.
 * - field: every piece on one radar (catalogue-field.js).
 * The state itself lives in catalogue-state.js.
 */

/* global esc, pad, money, priceHtml, colourOf, bearingLabel, productUrl */
/* global productCard, collectionData, products, radarData, radarPerf */
/* global showLoadError, STORAGE_KEYS, sessionStore */
/* global element, elements, targetElement, closestTarget */
/* global catalogueState, catalogueField */

(async () => {
  const buildStart = performance.now();
  const main = element(document, '#catalogue');
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
  // Start loading the next batch this far (px) before "Show more" is reached.
  const LOAD_AHEAD_PX = 600;
  // When the URL and the screen-reader announcement update after a change,
  // in ms: soon after a click, later while the visitor is still typing.
  const AFTER_CLICK = { statusMs: 50, urlMs: 0 };
  const WHILE_TYPING = { statusMs: 600, urlMs: 300 };

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const catalogue = catalogueState.create(location.search);
  const { state } = catalogue;

  /**
   * @param {!Piece} piece
   * @return {string} Its coordinate, e.g. 'R02 / 045°'.
   */
  const coord = piece =>
    `R${pad(piece.collection + 1)} / ${bearingLabel(piece)}°`;
  /**
   * @param {!Piece} piece
   * @return {string} Its product page URL, remembering we came from here.
   */
  const linkFor = piece => `${productUrl(piece)}&from=catalogue`;

  /**
   * @param {string} group
   * @param {string} value
   * @param {string} label
   * @return {string} HTML for one filter, sort or view button.
   */
  function chip(group, value, label) {
    return (
      `<button class="chip" data-group="${group}" data-value="${value}" ` +
      `aria-pressed="false">${esc(label)}</button>`
    );
  }

  /** @return {string} HTML for the filter rows. */
  function filtersHtml() {
    const rows = Object.entries(catalogue.groups)
      .map(([key, group]) => {
        const chips = group.options
          .map(([value, label]) => chip(key, value, label))
          .join('');
        return (
          `<div class="filter-row" role="group" aria-labelledby="filter-${key}">` +
          `<span class="filter-label" id="filter-${key}">${esc(group.label)}` +
          `</span>${chips}</div>`
        );
      })
      .join('');
    return `<div class="filters" id="filters">${rows}</div>`;
  }

  /** @return {string} HTML for the toolbar. */
  function toolbarHtml() {
    const sorts = catalogueState.SORTS.map(([value, label]) =>
      chip('sort', value, label),
    ).join('');
    const views = catalogueState.VIEWS.map(view =>
      chip('view', view, view),
    ).join('<span aria-hidden="true">/</span>');
    return (
      '<div class="toolbar"><button class="filter-toggle" ' +
      'aria-expanded="false" aria-controls="filters">Filter +</button>' +
      '<div class="sort-row" role="group" aria-labelledby="sort-label">' +
      `<span class="filter-label" id="sort-label">Sort</span>${sorts}</div>` +
      '<label class="search">' +
      '<span class="visually-hidden">Search the catalogue</span>' +
      '<input type="search" placeholder="Search" autocomplete="off" ' +
      `spellcheck="false" maxlength="${catalogueState.SEARCH_MAX}">` +
      '<kbd aria-hidden="true">/</kbd></label>' +
      '<p class="result-count" aria-hidden="true"></p>' +
      '<p class="visually-hidden" aria-live="polite" id="result-status"></p>' +
      '<button class="clear-filters" hidden>Clear ×</button>' +
      `<div class="view-switch" role="group" aria-label="View">${views}</div>` +
      '</div>'
    );
  }

  /** @return {string} HTML for the index table's frame. */
  function indexHtml() {
    const headings = [
      'No.',
      'Piece',
      'Collection',
      'Colour',
      'Artwork',
      'Coordinate',
      'Price',
    ];
    const head = headings.map(heading => `<span>${heading}</span>`).join('');
    return (
      '<section class="catalogue-index" aria-label="Catalogue index">' +
      `<div class="index-head" aria-hidden="true">${head}</div>` +
      '<ol class="index-list"></ol>' +
      '<div class="index-sweep" aria-hidden="true"></div></section>'
    );
  }

  element(document, '.catalogue-kicker').textContent =
    `${products.length} pieces / ${collectionData.length} collections`;
  main.insertAdjacentHTML(
    'beforeend',
    `${
      filtersHtml() + toolbarHtml()
    }<section class="catalogue-grid" aria-label="Catalogue grid"></section>${indexHtml()}<div class="load-more-row" hidden><span class="shown-count"></span>` +
      `<button class="load-more">Show more ↓</button></div>${catalogueField.markup()}<div class="empty-state" hidden>` +
      `<span class="mono muted">No signal</span>` +
      `<p>Nothing in range for these filters.</p>` +
      `<button class="clear-filters">Clear filters ×</button></div>`,
  );

  const grid = element(main, '.catalogue-grid');
  const indexSection = element(main, '.catalogue-index');
  const indexList = element(main, '.index-list');
  const fieldView = element(main, '.field-view');
  const toolbar = element(main, '.toolbar');
  const filters = element(main, '#filters');
  const search = /** @type {!HTMLInputElement} */ (element(toolbar, 'input'));
  const resultCount = element(toolbar, '.result-count');
  const resultStatus = element(toolbar, '#result-status');
  const filterToggle = element(toolbar, '.filter-toggle');
  const empty = element(main, '.empty-state');
  const moreRow = element(main, '.load-more-row');
  const sections = { grid, index: indexSection, field: fieldView };

  // Cards and rows are created on first use and cached, so a view costs
  // nothing until it is shown.
  const template = document.createElement('template');
  /** @type {!Map<!Piece, !HTMLElement>} */
  const cards = new Map();
  /** @type {!Map<!Piece, !HTMLElement>} */
  const rows = new Map();

  let visible = new Set(products); // pieces in range
  let currentList = products; // pieces in range, sorted
  let limit = GRID_BATCH; // how many of currentList the grid or index shows
  let statusTimer = 0;
  let urlTimer = 0;

  const field = catalogueField.mount({
    section: fieldView,
    state,
    motion,
    coord,
    linkFor,
    getList: () => currentList,
    isVisible: piece => visible.has(piece),
    apply,
  });

  /**
   * A piece's grid card, labelled with its coordinate.
   * @param {!Piece} piece
   * @return {!HTMLElement}
   */
  function cardFor(piece) {
    let card = cards.get(piece);
    if (!card) {
      template.innerHTML = productCard(piece);
      const link = /** @type {!HTMLAnchorElement} */ (
        template.content.firstElementChild
      );
      link.href = linkFor(piece);
      element(link, '.signal-tag').textContent = coord(piece);
      card = link;
      cards.set(piece, card);
    }
    return card;
  }

  /**
   * A piece's index row.
   * @param {!Piece} piece
   * @return {!HTMLElement}
   */
  function rowFor(piece) {
    let row = rows.get(piece);
    if (!row) {
      const collection = esc(collectionData[piece.collection].title);
      const name = esc(piece.name);
      const category = esc(piece.category);
      const label =
        `${name}, number ${piece.id}, ${collection}, ${colourOf(piece)}, ` +
        `${category}, ${coord(piece).replace('°', ' degrees')}, ${money(
          piece.price,
        )}`;
      template.innerHTML =
        `<li data-product="${piece.id}"><a class="index-row" ` +
        `href="${linkFor(piece)}" aria-label="${label}">` +
        `<span class="index-no">${piece.id}</span>` +
        `<span class="index-name">${name}</span>` +
        `<span>${collection}</span><span>${colourOf(piece)}</span>` +
        `<span>${category}</span>` +
        `<span class="index-coord">${coord(piece)}</span>` +
        `<span class="index-price">${priceHtml(piece)}</span></a></li>`;
      row = /** @type {!HTMLElement} */ (template.content.firstElementChild);
      rows.set(piece, row);
    }
    return row;
  }

  /** @return {number} How many items the current view adds per batch. */
  function batchSize() {
    return state.view === 'index' ? INDEX_BATCH : GRID_BATCH;
  }

  /** Saves the state in the URL, and for the product page's back link. */
  function writeUrl() {
    const query = catalogue.toQuery();
    history.replaceState(
      null,
      '',
      location.pathname + (query ? `?${query}` : ''),
    );
    sessionStore.set(STORAGE_KEYS.catalogue, query);
  }

  /**
   * Renders the grid or index from `from` up to the current limit.
   * @param {number} from 0 replaces the list; more appends a batch.
   * @return {!Array<!HTMLElement>} The items rendered.
   */
  function renderList(from) {
    const isGrid = state.view === 'grid';
    const container = isGrid ? grid : indexList;
    const items = currentList.slice(from, limit).map(isGrid ? cardFor : rowFor);
    items.forEach(item => item.classList.remove('arriving'));
    if (from) {
      container.append(...items);
    } else {
      container.replaceChildren(...items);
    }
    updateMoreRow();
    return items;
  }

  /** Shows "Showing N of M" and the "Show more" row when there is more. */
  function updateMoreRow() {
    const shown = Math.min(limit, currentList.length);
    moreRow.hidden = state.view === 'field' || shown >= currentList.length;
    element(moreRow, '.shown-count').textContent =
      `Showing ${shown} of ${currentList.length}`;
  }

  /**
   * Fades in the first items of a batch, with a single layout for the
   * whole batch (not one per element).
   * @param {!Array<!HTMLElement>} items
   */
  function animateIn(items) {
    if (motion.matches || !items.length) return;
    void main.offsetWidth; // one layout before the animations start
    items.slice(0, 24).forEach((item, i) => {
      item.style.animationDelay = `${Math.min(i, 14) * 22}ms`;
      item.classList.add('arriving');
    });
  }

  /**
   * Re-renders everything for the current state.
   * @return {!Array<!HTMLElement>} The list items rendered (none in the
   *     field view).
   */
  function render() {
    const applyStart = performance.now();
    currentList = catalogue.inRange();
    visible = new Set(currentList);
    limit = batchSize();
    /** @type {!Array<!HTMLElement>} */
    let items = [];
    if (state.view === 'field') {
      field.render();
    } else {
      items = renderList(0);
    }
    updateMoreRow();
    renderControls();
    if (state.view === 'field') field.updateContact();
    field.sync();
    radarPerf?.record('catalogue apply', performance.now() - applyStart);
    return items;
  }

  /**
   * Updates the screen-reader announcement and the URL after a delay.
   * @param {{statusMs: number, urlMs: number}} delays
   */
  function report({ statusMs, urlMs }) {
    const count = currentList.length;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      resultStatus.textContent = count
        ? `${count} of ${products.length} pieces in range`
        : 'No pieces match these filters';
    }, statusMs);
    clearTimeout(urlTimer);
    urlTimer = setTimeout(writeUrl, urlMs);
  }

  /**
   * Applies the state after a click or other one-off change.
   * @return {!Array<!HTMLElement>} The list items rendered.
   */
  function apply() {
    const items = render();
    report(AFTER_CLICK);
    return items;
  }

  /** Applies the state while the visitor types a search. */
  function applyWhileTyping() {
    render();
    report(WHILE_TYPING);
  }

  /** Chips, visible sections, counts and the filter toggle. */
  function renderControls() {
    const count = currentList.length;
    for (const button of elements(main, '.chip')) {
      const pressed =
        state[button.dataset.group ?? ''] === button.dataset.value;
      button.setAttribute('aria-pressed', String(pressed));
    }
    for (const [view, section] of Object.entries(sections)) {
      section.hidden = state.view !== view || (view !== 'field' && !count);
    }
    empty.hidden = !!count || state.view === 'field';
    element(toolbar, '.sort-row').hidden = state.view === 'field';
    const active = catalogue.activeFilterCount();
    element(toolbar, '.clear-filters').hidden = !active;
    const sign = filters.classList.contains('open') ? '−' : '+';
    filterToggle.textContent = `Filter ${sign}${active ? ` (${active})` : ''}`;
    resultCount.textContent = count
      ? `${pad(count)} of ${products.length} in range`
      : 'No signal';
  }

  /**
   * Renders the next batch of the grid or index.
   * @return {!Array<!HTMLElement>} The items added (none if there were no
   *     more).
   */
  function loadMore() {
    if (state.view === 'field' || limit >= currentList.length) return [];
    const from = limit;
    limit += batchSize();
    const items = renderList(from);
    animateIn(items);
    return items;
  }

  // "Show more" moves keyboard focus to the first new item, rather than
  // leaving it on the button.
  element(moreRow, '.load-more').addEventListener('click', () => {
    const [first] = loadMore();
    if (!first) return;
    const link = first.matches('a') ? first : element(first, 'a');
    link.focus({ preventScroll: true });
  });
  new IntersectionObserver(
    entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      loadMore();
      // A tall screen may still show the row after one batch; keep going
      // until it is out of reach.
      requestAnimationFrame(() => {
        const reach = innerHeight + LOAD_AHEAD_PX;
        if (!moreRow.hidden && moreRow.getBoundingClientRect().top < reach) {
          loadMore();
        }
      });
    },
    { rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px` },
  ).observe(moreRow);

  main.addEventListener('click', event => {
    const button = closestTarget(event, '.chip');
    if (button) {
      const group = button.dataset.group ?? '';
      const value = button.dataset.value ?? '';
      if (state[group] === value) return;
      state[group] = value;
      animateIn(apply());
      return;
    }
    if (closestTarget(event, '.clear-filters')) {
      catalogue.clearFilters();
      search.value = '';
      animateIn(apply());
    }
  });
  main.addEventListener('animationend', event => {
    const target = targetElement(event);
    if (target.classList.contains('arriving') && !target.closest('.contact')) {
      target.classList.remove('arriving');
    }
  });

  search.value = state.q;
  search.addEventListener('input', () => {
    state.q = search.value.trim();
    applyWhileTyping();
  });
  // "/" jumps to the search from anywhere outside a text field.
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (closestTarget(event, 'input,textarea,select,[contenteditable]')) return;
    event.preventDefault();
    search.focus();
    search.select();
  });

  filterToggle.addEventListener('click', () => {
    const open = !filters.classList.contains('open');
    filters.classList.toggle('open', open);
    filterToggle.setAttribute('aria-expanded', String(open));
    apply();
    // The toolbar may be pinned far down the page; bring the opened panel
    // into view beneath it.
    if (!open) return;
    const top =
      filters.getBoundingClientRect().top + scrollY - toolbar.offsetHeight - 4;
    if (top < scrollY) {
      scrollTo({ top, behavior: motion.matches ? 'instant' : 'smooth' });
    }
  });

  // Index: a sweep line passes down the rows, at a pace set by their height.
  const sweep = element(indexSection, '.index-sweep');
  new ResizeObserver(() => {
    sweep.style.setProperty('--top', `${indexList.offsetTop}px`);
    sweep.style.setProperty('--h', `${indexList.offsetHeight}px`);
    const seconds = Math.max(4, indexList.offsetHeight / 220);
    sweep.style.animationDuration = `${seconds.toFixed(1)}s`;
  }).observe(indexList);

  /**
   * Back from a product page: brings that piece into view and focuses it.
   * @param {!Piece} piece
   */
  function landOn(piece) {
    if (!visible.has(piece)) return;
    if (state.view === 'field') {
      // The piece may not be plotted at this level of detail: zoom into its
      // ring.
      if (!field.includes(piece)) {
        state.ring = collectionData[piece.collection].id;
        apply();
      }
      if (!field.includes(piece)) return;
      // Select explicitly: focus events don't fire while the window itself
      // isn't focused yet.
      field.select(piece);
    } else {
      // Make sure the piece's batch is rendered before scrolling to it.
      const index = currentList.indexOf(piece);
      if (index >= limit) {
        limit = Math.ceil((index + 1) / batchSize()) * batchSize();
        renderList(0);
      }
    }
    // In the field view the piece is plotted (checked above), so it has a
    // blip.
    const target =
      state.view === 'field'
        ? /** @type {!HTMLElement} */ (field.blipFor(piece))
        : state.view === 'index'
          ? element(rowFor(piece), 'a')
          : cardFor(piece);
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    target.focus({ preventScroll: true });
    target.classList.add('returned');
  }

  apply();
  if (catalogue.returning) landOn(catalogue.returning);
  radarPerf?.record('catalogue build', performance.now() - buildStart);
})();
