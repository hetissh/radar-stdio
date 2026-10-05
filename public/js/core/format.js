/**
 * @fileoverview Text and number formatting shared by every page.
 *
 * Security: every catalogue value placed into HTML goes through esc(). Data
 * comes from Shopify (entered by merchants) and the bag from localStorage, so
 * neither may ever be treated as markup.
 *
 * This is the first script on every page; tools/export.py relies on that.
 */

/* exported esc, escLines, pad, clamp, money */

const { esc, escLines, pad, clamp, money } = (() => {
  const HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  /**
   * Escapes text for safe use in HTML content and attribute values.
   * @param {*} value Any value; null and undefined become ''.
   * @return {string}
   */
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => HTML_ENTITIES[char]);
  }

  /**
   * Like esc(), but keeps intended line breaks as <br>.
   * @param {*} value
   * @return {string}
   */
  function escLines(value) {
    return esc(value).replace(/\n/g, '<br>');
  }

  /**
   * Pads a number with leading zeros: pad(7) is '07', pad(45, 3) is '045'.
   * @param {number|string} value
   * @param {number=} width Minimum number of characters.
   * @return {string}
   */
  function pad(value, width = 2) {
    return String(value).padStart(width, '0');
  }

  /**
   * Limits a number to a range.
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @return {number}
   */
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Formats rupees the Indian way: 123456 becomes '₹1,23,456'.
   * @param {number} amount
   * @return {string}
   */
  function money(amount) {
    return `₹${amount.toLocaleString('en-IN')}`;
  }

  return { esc, escLines, pad, clamp, money };
})();
