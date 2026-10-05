/**
 * @fileoverview The catalogue's state: filters, sort, search, view and zoomed
 * ring, read from and written back to the URL, and which pieces are in range.
 * No DOM access, so it can be tested on its own.
 */

/* exported catalogueState */
/* global collectionData, products, colourOf, productById */

const catalogueState = (() => {
  // Longest search accepted, in characters.
  const SEARCH_MAX = 60;
  const VIEWS = ['field', 'grid', 'index'];
  const SORTS = [
    ['orbit', 'Orbit'],
    ['price-up', 'Price ↑'],
    ['price-down', 'Price ↓'],
    ['name', 'Name'],
  ];
  const DEFAULTS = Object.freeze({
    view: 'grid',
    collection: 'all',
    colour: 'all',
    artwork: 'all',
    sort: 'orbit',
    q: '',
    ring: '',
  });
  const FILTER_KEYS = ['collection', 'colour', 'artwork'];

  /**
   * A URL-safe version of a label: 'Objects & clothing' is
   * 'objects-and-clothing'.
   * @param {string} text
   * @return {string}
   */
  function slug(text) {
    return text
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Lowercase without accents, so a search for "cafe" finds "Café".
   * @param {string} text
   * @return {string}
   */
  function fold(text) {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Orbit order: ring by ring, then clockwise by bearing.
   * @param {!Piece} a
   * @param {!Piece} b
   * @return {number}
   */
  function byOrbit(a, b) {
    return (
      a.collection - b.collection ||
      a.bearing - b.bearing ||
      a.position - b.position
    );
  }

  const ORDER = {
    'orbit': byOrbit,
    'price-up': (a, b) => a.price - b.price || byOrbit(a, b),
    'price-down': (a, b) => b.price - a.price || byOrbit(a, b),
    'name': (a, b) => a.name.localeCompare(b.name),
  };

  /**
   * Whether `value` is one of a list of [value, label] options.
   * @param {!Array<!Array<string>>} options
   * @param {?string} value
   * @return {boolean}
   */
  function isOption(options, value) {
    return options.some(([option]) => option === value);
  }

  /**
   * Creates the state for the loaded catalogue from a URL query string.
   * Unknown values in the URL are ignored.
   * @param {string} search location.search.
   * @return {{
   *   state: !Object<string, string>,
   *   groups: !Object<string, {label: string, options: !Array<!Array<string>>}>,
   *   returning: (!Piece|undefined),
   *   inRange: function(): !Array<!Piece>,
   *   toQuery: function(): string,
   *   activeFilterCount: function(): number,
   *   clearFilters: function(),
   * }} returning is the piece the visitor came back from (?piece=ID).
   */
  function create(search) {
    const categories = [...new Set(products.map(piece => piece.category))];
    const groups = {
      collection: {
        label: 'Collection',
        options: [
          ['all', 'All'],
          ...collectionData.map(collection => [
            collection.id,
            collection.title,
          ]),
        ],
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
          ...categories.map(category => [slug(category), category]),
        ],
      },
    };

    const params = new URLSearchParams(search);
    const state = { ...DEFAULTS };
    for (const [key, group] of Object.entries(groups)) {
      if (isOption(group.options, params.get(key))) {
        state[key] = params.get(key);
      }
    }
    if (VIEWS.includes(params.get('view'))) state.view = params.get('view');
    if (isOption(SORTS, params.get('sort'))) state.sort = params.get('sort');
    state.q = (params.get('q') || '').trim().slice(0, SEARCH_MAX);
    const ringIds = collectionData.map(collection => collection.id);
    if (ringIds.includes(params.get('ring'))) state.ring = params.get('ring');

    // Search matches every word against a piece's names, discipline,
    // category, collection and colour.
    const haystack = new Map(
      products.map(piece => {
        const fields = [
          piece.name,
          piece.title,
          piece.discipline,
          piece.category,
          collectionData[piece.collection].title,
          colourOf(piece),
        ];
        return [piece, fold(fields.join(' '))];
      }),
    );

    /**
     * @param {!Piece} piece
     * @param {!Array<string>} words The folded search words.
     * @return {boolean} Whether the piece passes every filter and the search.
     */
    function matches(piece, words) {
      return (
        (state.collection === 'all' ||
          collectionData[piece.collection].id === state.collection) &&
        (state.colour === 'all' || (state.colour === 'black') === piece.dark) &&
        (state.artwork === 'all' || slug(piece.category) === state.artwork) &&
        words.every(word => haystack.get(piece).includes(word))
      );
    }

    /** @return {!Array<!Piece>} The pieces in range, in the chosen order. */
    function inRange() {
      const words = fold(state.q).split(/\s+/).filter(Boolean);
      return products
        .filter(piece => matches(piece, words))
        .sort(ORDER[state.sort]);
    }

    /** @return {string} The URL query for the state, without defaults. */
    function toQuery() {
      const query = new URLSearchParams();
      for (const key of Object.keys(DEFAULTS)) {
        if (state[key] !== DEFAULTS[key]) query.set(key, state[key]);
      }
      return query.toString();
    }

    /** @return {number} Filters in use, counting a search as one. */
    function activeFilterCount() {
      const filters = FILTER_KEYS.filter(key => state[key] !== 'all').length;
      return filters + (state.q ? 1 : 0);
    }

    /** Resets the filters and the search (not the view or sort). */
    function clearFilters() {
      for (const key of FILTER_KEYS) {
        state[key] = 'all';
      }
      state.q = '';
    }

    return {
      state,
      groups,
      returning: productById(params.get('piece') || ''),
      inRange,
      toQuery,
      activeFilterCount,
      clearFilters,
    };
  }

  return { SEARCH_MAX, VIEWS, SORTS, byOrbit, create };
})();
