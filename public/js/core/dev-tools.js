/**
 * @fileoverview Development tools, active only on local hosts and files opened
 * from disk, never on the public site:
 * - ?stress=N (1–5000) adds N synthetic pieces for this tab's session, to test
 *   the pages at scale; ?stress=0 turns it off. A badge marks stress data.
 * - ?perf (or ?stress) records timings: run radarPerf.report() in the console.
 */

/* exported stressCount, radarPerf, addStressPieces, showStressBadge */
/* global clamp, element, STORAGE_KEYS, sessionStore */
/* global collectionData, products, freeBearing */

/**
 * One named timing statistic, in milliseconds.
 * @typedef {{count: number, total: number, max: number, last: number}} PerfStat
 */

/**
 * What radarPerf.report() prints: one row of numbers per statistic.
 * @typedef {!Record<string, !Record<string, number>>} PerfRows
 */

const { stressCount, radarPerf, addStressPieces, showStressBadge } = (() => {
  const STRESS_MAX = 5000;
  // Synthetic ids continue after the 34 supplied pieces.
  const STRESS_FIRST_ID = 35;

  const isDevHost =
    location.protocol === 'file:' ||
    ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname) ||
    location.hostname.endsWith('.localhost');

  /**
   * How many synthetic pieces to add: from ?stress, remembered for the session.
   * @return {number}
   */
  function readStressCount() {
    if (!isDevHost) {
      sessionStore.remove(STORAGE_KEYS.stress);
      return 0;
    }
    const requested = new URLSearchParams(location.search).get('stress');
    if (requested === null) {
      return Number(sessionStore.get(STORAGE_KEYS.stress)) || 0;
    }
    const count = clamp(parseInt(requested, 10) || 0, 0, STRESS_MAX);
    if (count) {
      sessionStore.set(STORAGE_KEYS.stress, count);
    } else {
      sessionStore.remove(STORAGE_KEYS.stress);
    }
    return count;
  }

  const stressCount = readStressCount();

  /**
   * Collects timings while ?stress or ?perf is on.
   * @return {?{record: function(string, number): void,
   *     report: function(): !PerfRows}}
   */
  function createPerf() {
    const enabled =
      isDevHost &&
      (stressCount || new URLSearchParams(location.search).has('perf'));
    if (!enabled) return null;
    const perf = {
      /** @type {!Record<string, !PerfStat>} Raw statistics, by name. */
      stats: {},

      /**
       * Adds one timing to a named statistic.
       * @param {string} name
       * @param {number} ms
       */
      record(name, ms) {
        this.stats[name] ??= { count: 0, total: 0, max: 0, last: 0 };
        const stat = this.stats[name];
        stat.count++;
        stat.total += ms;
        stat.max = Math.max(stat.max, ms);
        stat.last = ms;
      },

      /**
       * Prints every statistic, the page's size and its image traffic.
       * @return {!PerfRows} The rows printed.
       */
      report() {
        /** @type {!PerfRows} */
        const rows = {};
        for (const [name, stat] of Object.entries(this.stats)) {
          rows[name] = {
            count: stat.count,
            avgMs: +(stat.total / stat.count).toFixed(2),
            maxMs: +stat.max.toFixed(2),
          };
        }
        const resources = /** @type {!Array<!PerformanceResourceTiming>} */ (
          performance.getEntriesByType('resource')
        );
        const images = resources.filter(entry => entry.initiatorType === 'img');
        const imageBytes = images.reduce(
          (total, entry) =>
            total + (entry.transferSize || entry.encodedBodySize || 0),
          0,
        );
        rows['page elements'] = {
          count: document.getElementsByTagName('*').length,
        };
        rows['images requested'] = {
          count: images.length,
          MB: +(imageBytes / 1048576).toFixed(1),
        };
        console.table(rows);
        return rows;
      },
    };
    const observesLongTasks =
      window.PerformanceObserver &&
      PerformanceObserver.supportedEntryTypes.includes('longtask');
    if (observesLongTasks) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          perf.record('long task (>50ms)', entry.duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    }
    return perf;
  }

  /**
   * Appends stressCount synthetic pieces to the loaded catalogue. They copy
   * the real pieces (artwork, text), fill each collection in turn and take
   * bearings from freeBearing().
   */
  function addStressPieces() {
    const real = products.slice();
    const taken = collectionData.map((collection, ring) =>
      products
        .filter(piece => piece.collection === ring)
        .map(piece => piece.bearing),
    );
    for (let i = 0; i < stressCount; i++) {
      const ring = i % collectionData.length;
      const source = real[i % real.length];
      const id = String(STRESS_FIRST_ID + i);
      const position = collectionData[ring].count;
      const original = 2200 + (position % 3) * 200;
      const bearing = freeBearing(taken[ring]);
      taken[ring].push(bearing);
      collectionData[ring].count++;
      const reducedPrice = Math.round((original * 0.65) / 100) * 100;
      products.push({
        ...source,
        id,
        base: source.id,
        title: `${source.title} / variant ${i + 1}`,
        name: `Signal ${id} tee`,
        collection: ring,
        position,
        original,
        price:
          collectionData[ring].id === 'end-of-season' ? reducedPrice : original,
        dark: position % 3 === 1,
        bearing,
        synthetic: true,
      });
    }
  }

  /** Shows a badge so stress data is never mistaken for the real catalogue. */
  function showStressBadge() {
    if (!stressCount || document.querySelector('.stress-badge')) return;
    const total = collectionData.reduce(
      (sum, collection) => sum + collection.count,
      0,
    );
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="stress-badge" role="status">' +
        `Stress test · ${total.toLocaleString('en-IN')} pieces ` +
        '<button type="button">Exit</button></div>',
    );
    element(document, '.stress-badge button').addEventListener('click', () => {
      sessionStore.remove(STORAGE_KEYS.stress);
      const query = new URLSearchParams(location.search);
      query.delete('stress');
      location.search = query.toString();
    });
  }

  return {
    stressCount,
    radarPerf: createPerf(),
    addStressPieces,
    showStressBadge,
  };
})();
