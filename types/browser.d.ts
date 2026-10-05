/**
 * @fileoverview Globals the browser scripts read but don't define: data
 * bundled into the page by scripts/build_data.py (data/inline.js, for pages
 * opened from disk) and scripts/export.py (the portable export).
 */

interface Window {
  /** Every data file, keyed by path (e.g. 'data/home.json'). */
  radarInlineData?: Record<string, unknown>;
}

/**
 * Artwork file name → data URL; defined only in the portable export.
 */
declare var assetUrls: Record<string, string> | undefined;
