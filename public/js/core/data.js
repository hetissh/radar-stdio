/**
 * @fileoverview Catalogue data: loading, lookups and bearings.
 *
 * The catalogue lives in data/ (generated from data/products.json by
 * scripts/build_data.py), and each page loads only what it needs:
 * radarData.home() the homepage file, radarData.all() every summary (the
 * catalogue), radarData.piece(id) one piece in full plus its collection (the
 * product page). Until a loader resolves, collectionData and products are
 * empty; page scripts start from the loader's promise.
 *
 * A piece's coordinate is its ring (its collection: R01 innermost) and its
 * bearing (its permanent place, in degrees, around that ring).
 */

/* exported collectionData, products, radarData, productById, showLoadError */
/* exported bearingOf, bearingLabel, freeBearing */
/* global esc, pad, stressCount, addStressPieces, showStressBadge, bag */

/**
 * A collection, as loaded (one ring of the radar).
 * @typedef {Object} Collection
 * @property {string} id URL-safe handle, e.g. 'new-arrivals'.
 * @property {string} title
 * @property {string} copy Short description; may contain line breaks.
 * @property {number} count Pieces in the whole collection.
 */

/**
 * One item a product page can show: the garment's front or back, a photo or
 * a video. Paths are relative to assets/.
 * @typedef {Object} MediaItem
 * @property {string} type 'garment', 'image' or 'video'.
 * @property {string} label
 * @property {string=} side Garments: 'front' or 'back'.
 * @property {string=} src Images and videos.
 * @property {string=} poster Videos.
 * @property {string=} alt Images and videos.
 * @property {string=} mode Videos: 'loop' (muted, autoplays) or 'film'.
 * @property {string=} captions Videos: a WebVTT file.
 */

/**
 * A piece (one garment). Summaries leave out description, status and media,
 * which only radarData.piece() loads.
 * @typedef {Object} Piece
 * @property {string} id Two or more digits, e.g. '07'.
 * @property {string} name
 * @property {string} title The artwork's title.
 * @property {string} discipline
 * @property {string} category
 * @property {string} image Artwork: a file in assets/ or a Shopify CDN URL.
 * @property {number} collection Ring index into collectionData.
 * @property {number} position Curated order within the collection.
 * @property {number} bearing Degrees around the ring.
 * @property {number} price
 * @property {number} original Higher than price when the piece is reduced.
 * @property {boolean} dark Washed black (true) or chalk.
 * @property {string=} description
 * @property {string=} status
 * @property {!Array<!MediaItem>=} media
 * @property {string=} base Stress pieces: the id of the piece they copy.
 * @property {boolean=} synthetic Stress pieces only.
 */

/**
 * A data file as loaded (data/home.json, data/index.json or one collection's
 * file). Its pieces name their collection by id, not by ring index.
 * @typedef {Object} CatalogueFile
 * @property {!Array<!Collection>} collections
 * @property {!Array<!Object>} products
 */

/** @type {!Array<!Collection>} */
let collectionData = [];
/** @type {!Array<!Piece>} */
let products = [];

const { radarData, productById, bearingOf, bearingLabel, freeBearing } =
  (() => {
    /** @type {!Map<string, !Piece>} */
    let productIndex = new Map();

    /**
     * Loads a classic script; resolves once it has loaded or failed. The
     * caller checks for what the script should have defined.
     * @param {string} src
     * @return {!Promise<void>}
     */
    function loadScript(src) {
      return new Promise(resolve => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = resolve;
        document.head.append(script);
      });
    }

    /**
     * Fetches a data file. Pages opened from disk (file://) can't fetch, so
     * there it falls back to the bundled copy of every file, data/inline.js.
     * @param {string} path For example 'data/home.json'.
     * @return {!Promise<!Object>}
     */
    async function getData(path) {
      const inline = () => window.radarInlineData?.[path];
      if (inline()) return inline();
      try {
        // no-cache revalidates with the server, so edited data shows up
        // without version strings.
        const response = await fetch(path, { cache: 'no-cache' });
        if (!response.ok) {
          throw Object.assign(new Error(`${path} ${response.status}`), {
            status: response.status,
          });
        }
        return await response.json();
      } catch (error) {
        if (location.protocol === 'file:' && !window.radarInlineData) {
          await loadScript('data/inline.js');
        }
        if (inline()) return inline();
        throw error;
      }
    }

    /**
     * Like getData(), but a missing file (404) resolves to null. Any other
     * failure still rejects, so the page can offer a retry.
     * @param {string} path
     * @return {!Promise<?Object>}
     */
    async function getOptionalData(path) {
      try {
        return await getData(path);
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    }

    /**
     * Makes a loaded data file the current catalogue.
     * @param {!CatalogueFile} file
     */
    function useCatalogue(file) {
      collectionData = file.collections.map(collection => ({ ...collection }));
      const ringOf = new Map(
        collectionData.map((collection, ring) => [collection.id, ring]),
      );
      products = file.products.map(piece => ({
        ...piece,
        collection: ringOf.get(piece.collection),
      }));
      collectionData.forEach((collection, ring) =>
        checkBearings(
          products.filter(piece => piece.collection === ring),
          ring,
        ),
      );
      if (stressCount) addStressPieces();
      productIndex = new Map(products.map(piece => [piece.id, piece]));
      bag.fill();
      showStressBadge();
    }

    /**
     * Every piece should have a stored bearing. A missing one gets a
     * temporary free spot; pieces sharing a bearing are reported.
     * @param {!Array<!Piece>} pieces One ring's pieces.
     * @param {number} ring
     */
    function checkBearings(pieces, ring) {
      const seen = new Set();
      for (const piece of pieces) {
        if (piece.bearing === undefined) {
          piece.bearing = freeBearing(
            pieces
              .filter(other => other.bearing !== undefined)
              .map(other => other.bearing),
          );
          console.warn(
            `RADAR: piece ${piece.id} has no stored bearing; using ` +
              `${piece.bearing}° for now. Add it to data/products.json so ` +
              'it stays put.',
          );
        }
        if (seen.has(piece.bearing)) {
          console.warn(
            `RADAR: two pieces share bearing ${piece.bearing}° on ring ` +
              `${ring + 1}.`,
          );
        }
        seen.add(piece.bearing);
      }
    }

    /**
     * Looks a piece up by id; '7', 7 and '07' all find piece 07.
     * @param {number|string} id
     * @return {!Piece|undefined}
     */
    function productById(id) {
      return productIndex.get(pad(id));
    }

    /**
     * @param {!Piece} piece
     * @return {number} Degrees around the piece's ring.
     */
    function bearingOf(piece) {
      return piece.bearing;
    }

    /**
     * A bearing as the readouts show it: '045' or '007.5'.
     * @param {!Piece} piece
     * @return {string}
     */
    function bearingLabel(piece) {
      return Number.isInteger(piece.bearing)
        ? pad(piece.bearing, 3)
        : piece.bearing.toFixed(1).padStart(5, '0');
    }

    /**
     * The middle of the widest free gap on a ring: where a new piece should
     * go. Also handy in the console when adding a piece by hand.
     * @param {!Array<number>} taken Bearings already used on the ring.
     * @return {number} Degrees, to one decimal place.
     */
    function freeBearing(taken) {
      if (!taken.length) return 0;
      const sorted = [...taken].sort((a, b) => a - b);
      let widest = 0;
      let middle = 0;
      sorted.forEach((bearing, i) => {
        const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360;
        const gap = next - bearing;
        if (gap > widest) {
          widest = gap;
          middle = bearing + gap / 2;
        }
      });
      return Math.round((middle % 360) * 10) / 10;
    }

    const radarData = {
      /**
       * Loads the homepage's data: collections and their featured pieces.
       * @return {!Promise<void>}
       */
      async home() {
        if (stressCount) return this.all();
        useCatalogue(await getData('data/home.json'));
      },

      /**
       * Loads every piece's summary.
       * @return {!Promise<void>}
       */
      async all() {
        useCatalogue(await getData('data/index.json'));
      },

      /**
       * Loads one piece in full, with its collection's summaries.
       * @param {number|string} id
       * @return {!Promise<?Piece>} Null if there is no such piece.
       */
      async piece(id) {
        const key = pad(id);
        if (stressCount) {
          await this.all();
          const piece = productById(key);
          if (!piece) return null;
          const detail = await getOptionalData(
            `data/pieces/${piece.base || piece.id}.json`,
          );
          return Object.assign(piece, {
            description: detail ? detail.description : '',
            status: detail ? detail.status : '',
            media: detail && !piece.synthetic ? detail.media : undefined,
          });
        }
        if (!/^\d+$/.test(key)) return null;
        const detail = await getOptionalData(`data/pieces/${key}.json`);
        if (!detail) return null;
        useCatalogue(
          await getData(`data/collections/${detail.collection}.json`),
        );
        return Object.assign(productById(key), {
          description: detail.description,
          status: detail.status,
          media: detail.media,
        });
      },
    };

    return { radarData, productById, bearingOf, bearingLabel, freeBearing };
  })();

/**
 * Replaces missing content with an explanation and a retry button, when the
 * catalogue data can't be loaded (offline, server error).
 * @param {!Element} container Where the message goes.
 * @param {string} what What failed to load, e.g. 'the catalogue'.
 */
function showLoadError(container, what) {
  console.error(`RADAR: could not load ${what}.`);
  container.insertAdjacentHTML(
    'beforeend',
    '<section class="load-error" role="alert">' +
      '<span class="mono muted">Signal interrupted</span>' +
      `<h2>We couldn’t load ${esc(what)}.</h2>` +
      '<p>Check your connection and try again.</p>' +
      '<button type="button" class="load-retry mono">Retry ↻</button>' +
      '</section>',
  );
  container
    .querySelector('.load-retry')
    .addEventListener('click', () => location.reload());
}
