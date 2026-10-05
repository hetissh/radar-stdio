/**
 * @fileoverview The catalogue field's contact panel: details of one piece.
 * It follows what the sweep finds ("Tracking"), unless the visitor hovers,
 * focuses or taps a blip ("Selected"); a selection holds for a moment after
 * the pointer or focus leaves. When there are too many pieces to plot it
 * shows an overview of the rings instead.
 *
 * catalogue-field.js drives it through the controller returned by
 * catalogueContact.mount().
 */

/* exported catalogueContact */
/* global esc, pad, element, art, priceHtml, colourOf, collectionData */

const catalogueContact = (() => {
  // Fastest the panel moves from piece to piece while tracking, in ms.
  const TRACK_INTERVAL_MS = 1700;
  // How long a selection holds after the pointer or focus leaves, in ms.
  const RELEASE_MS = 2500;

  const NO_SIGNAL_HTML =
    '<div class="contact-head"><span>Contact / <b>None</b></span></div>' +
    '<div class="contact-body contact-empty"><h2>No signal</h2>' +
    '<p>Nothing in range for these filters.</p>' +
    '<button class="clear-filters">Clear filters ×</button></div>';

  /**
   * Wires up the panel.
   * @param {{
   *   panel: !HTMLElement,
   *   motion: !MediaQueryList,
   *   coord: function(!Piece): string,
   *   linkFor: function(!Piece): string,
   *   getShown: function(): !Array<!Piece>,
   *   blipFor: function(!Piece): !HTMLElement,
   * }} options panel is the <aside class="contact">; motion is the
   *     prefers-reduced-motion query; coord gives a piece's coordinate
   *     label; linkFor its product page URL; getShown the plotted pieces;
   *     blipFor a plotted piece's blip.
   * @return {{
   *   show: function(?Piece, string): void,
   *   showOverview: function(!Array<number>, number): void,
   *   current: function(): ?Piece,
   *   select: function(!Piece): void,
   *   release: function(): void,
   *   track: function(!Piece, number): void,
   * }}
   */
  function mount({ panel, motion, coord, linkFor, getShown, blipFor }) {
    /** @type {?Piece} */
    let piece = null;
    let locked = false; // a visitor's selection: the sweep doesn't move it
    let unlockTimer = 0;
    let lastSwap = 0;

    /**
     * Shows an overview of the rings, when there are too many pieces to plot
     * one by one.
     * @param {!Array<number>} ringCounts Pieces in range on each ring.
     * @param {number} total Pieces in range.
     */
    function showOverview(ringCounts, total) {
      piece = null;
      panel.dataset.mode = 'overview';
      const rings = collectionData
        .map((collection, ring) => {
          const count = ringCounts[ring];
          return (
            `<li><button data-ring="${esc(ring)}"${count ? '' : ' disabled'}>` +
            `<span>${pad(ring + 1)} ${esc(collection.title)}</span>` +
            `<span>${count.toLocaleString('en-IN')} ↗</span></button></li>`
          );
        })
        .join('');
      panel.innerHTML =
        '<div class="contact-head"><span>Contact / <b>Overview</b></span>' +
        `<span>${total.toLocaleString('en-IN')} in range</span></div>` +
        '<div class="contact-body">' +
        '<h2>Too many signals to plot one by one</h2>' +
        '<p class="contact-note">Zoom into a ring, or narrow the filters.</p>' +
        `<ul class="ring-list">${rings}</ul></div>`;
    }

    /**
     * Shows a piece, or "No signal" when nothing is in range.
     * @param {?Piece} next
     * @param {string} mode 'selected' (the visitor's choice) or 'tracking'
     *     (following the sweep).
     */
    function show(next, mode) {
      const unchanged =
        next === piece &&
        panel.dataset.mode === mode &&
        panel.childElementCount;
      if (unchanged) return;
      piece = next;
      panel.dataset.mode = mode;
      for (const plotted of getShown()) {
        blipFor(plotted).classList.toggle('active', plotted === next);
      }
      panel.innerHTML = next ? pieceHtml(next, mode) : NO_SIGNAL_HTML;
      if (next && !motion.matches) {
        element(panel, '.contact-body').classList.add('arriving');
      }
    }

    /**
     * @param {!Piece} shown
     * @param {string} mode
     * @return {string} The panel's HTML for a piece.
     */
    function pieceHtml(shown, mode) {
      const label = mode === 'selected' ? 'Selected' : 'Tracking';
      const garment = art(shown, { eager: true, sizes: '200px' });
      const collection = esc(collectionData[shown.collection].title);
      return (
        `<div class="contact-head"><span>Contact / <b>${label}</b></span>` +
        `<span>${coord(shown)}</span></div>` +
        '<div class="contact-body">' +
        '<div class="garment-space contact-garment">' +
        `<div class="concept-tee${shown.dark ? ' dark' : ''}" data-morph>` +
        `${garment}</div></div>` +
        `<span class="contact-no">No. ${shown.id} · ${collection}</span>` +
        `<h2>${esc(shown.name)}</h2>` +
        `<p class="contact-price">${priceHtml(shown)}</p>` +
        '<dl class="contact-readout">' +
        `<div><dt class="readout-label">Colour</dt><dd class="readout-value">${colourOf(shown)}</dd></div>` +
        `<div><dt class="readout-label">Artwork</dt><dd class="readout-value">${esc(shown.title)}</dd></div>` +
        `<div><dt class="readout-label">Discipline</dt><dd class="readout-value">${esc(shown.discipline)}</dd></div>` +
        '</dl>' +
        `<a class="contact-open" href="${linkFor(shown)}">` +
        '<span>Open piece</span><span aria-hidden="true">↗</span></a></div>'
      );
    }

    /**
     * Shows a piece as the visitor's selection, holding it.
     * @param {!Piece} chosen
     */
    function select(chosen) {
      hold();
      show(chosen, 'selected');
    }

    /** Stops the sweep from moving the panel. */
    function hold() {
      clearTimeout(unlockTimer);
      locked = true;
    }

    /** Lets the sweep move the panel again, after a moment. */
    function release() {
      clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => {
        locked = false;
      }, RELEASE_MS);
    }

    /**
     * Follows what the sweep found, at a readable pace, unless held.
     * @param {!Piece} found
     * @param {number} now
     */
    function track(found, now) {
      if (locked || now - lastSwap <= TRACK_INTERVAL_MS) return;
      show(found, 'tracking');
      lastSwap = now;
    }

    panel.addEventListener('pointerenter', hold);
    panel.addEventListener('pointerleave', release);
    panel.addEventListener('focusin', hold);
    panel.addEventListener('focusout', release);

    return {
      show,
      showOverview,
      current: () => piece,
      select,
      release,
      track,
    };
  }

  return { mount };
})();
