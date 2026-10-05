/**
 * @fileoverview Browser storage that never throws, and the keys the site
 * keeps there. Storage can be unavailable (private browsing, blocked cookies)
 * and then throws when touched: reads fall back to null and writes are
 * skipped, so the site keeps working without it.
 */

/* exported STORAGE_KEYS, localStore, sessionStore */

/**
 * Keys of everything the site keeps in browser storage.
 * @const {!Record<string, string>}
 */
const STORAGE_KEYS = Object.freeze({
  bag: 'radar-bag',
  // Also read by the inline script in each page's <head>, before first paint.
  theme: 'radar-theme',
  stress: 'radar-stress',
  // The last catalogue view, for the product page's "← Catalogue" link.
  catalogue: 'radar-catalogue',
});

const { localStore, sessionStore } = (() => {
  /**
   * Wraps a storage area so that none of its methods can throw.
   * @param {'localStorage'|'sessionStorage'} area
   * @return {{
   *   get: function(string): ?string,
   *   set: function(string, *): void,
   *   remove: function(string): void,
   * }}
   */
  function safeStorage(area) {
    const store = () => window[area];
    return {
      /**
       * @param {string} key
       * @return {?string} The stored value, or null if missing or unavailable.
       */
      get(key) {
        try {
          return store().getItem(key);
        } catch {
          // Unavailable storage reads as empty.
          return null;
        }
      },

      /**
       * @param {string} key
       * @param {*} value Stored as a string.
       */
      set(key, value) {
        try {
          store().setItem(key, value);
        } catch {
          // Unavailable or full storage: the value is simply not kept.
        }
      },

      /** @param {string} key */
      remove(key) {
        try {
          store().removeItem(key);
        } catch {
          // Unavailable storage has nothing to remove.
        }
      },
    };
  }

  return {
    localStore: safeStorage('localStorage'),
    sessionStore: safeStorage('sessionStorage'),
  };
})();
