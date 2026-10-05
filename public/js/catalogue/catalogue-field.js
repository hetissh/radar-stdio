/**
 * @fileoverview The catalogue's field view: every piece in range plotted on
 * one radar, at the coordinate its product page reports (ring = collection,
 * bearing = place on that orbit), beside a contact panel.
 *
 * Levels of detail:
 * - detail: every piece in range is a blip on its collection ring, while
 *   each ring has room.
 * - summary: too many to plot one by one; rings show their counts, and you
 *   zoom into one.
 * - zoom: one collection fills the radar. Bearings are kept; pieces
 *   alternate across a few bands.
 * Only pieces in range get a link (a blip); the canvas (catalogue-radar.js)
 * draws everything else as faint dots, so the page stays light. The panel is
 * catalogue-contact.js.
 *
 * catalogue.js inserts catalogueField.markup(), then drives the view through
 * the controller returned by catalogueField.mount().
 */

/* exported catalogueField */
/* global esc, pad, money, colourOf, collectionData, products, productById */
/* global catalogueState, catalogueRadar, catalogueContact */

/**
 * The field's live layout, shared with catalogue-radar.js.
 * @typedef {Object} FieldLayout
 * @property {string} mode 'detail', 'summary' or 'zoom'.
 * @property {number} zoomRing The ring zoomed into, or -1.
 * @property {boolean} autoZoom Zoomed because only one ring is in range.
 * @property {!Array<number>} ringCounts Pieces in range on each ring.
 * @property {!Array<!Piece>} shown Pieces plotted as blips, in orbit order.
 * @property {function(number): number} ringRadius
 * @property {function(): !Array<number>} zoomRadii The zoomed ring's bands.
 * @property {function(!Piece): !Array<number>} pointOf [left, top] in %.
 * @property {function(!Piece): boolean} isVisible Whether it is in range.
 */

const catalogueField = (() => {
  // More pieces in range than this switches to summary.
  const DETAIL_MAX = 150;
  // Pixels of ring circumference each blip needs.
  const BLIP_SPACING = 14;
  // Above this many blips, they are drawn smaller.
  const DENSE_BLIPS = 60;
  // A zoomed ring gets one band per this many pieces, up to MAX_BANDS.
  const PIECES_PER_BAND = 48;
  const MAX_BANDS = 6;

  /**
   * A ring's radius as a fraction of the field's half-width; R01 is
   * innermost, as on the homepage locator.
   * @param {number} ring
   * @return {number}
   */
  function ringRadius(ring) {
    return ((ring + 1.4) / 4.4) * 0.8;
  }

  /**
   * CSS position for a point on the field.
   * @param {number} fraction Distance from the centre, of the half-width.
   * @param {number} degrees Compass bearing.
   * @return {string} 'left:…%;top:…%'
   */
  function at(fraction, degrees) {
    const angle = (degrees * Math.PI) / 180;
    const left = (50 + 50 * fraction * Math.sin(angle)).toFixed(3);
    const top = (50 - 50 * fraction * Math.cos(angle)).toFixed(3);
    return `left:${left}%;top:${top}%`;
  }

  /** @return {string} HTML for the field view's <section>. */
  function markup() {
    const ringLabels = collectionData
      .map((collection, ring) => {
        const style = at(ringRadius(ring), 22.5);
        return (
          `<button class="ring-label" data-ring="${esc(ring)}" ` +
          `style="${style}">${pad(ring + 1)}</button>`
        );
      })
      .join('');
    const legend = collectionData
      .map((collection, ring) => {
        return `<span>${pad(ring + 1)} ${esc(collection.title)}</span>`;
      })
      .join('');
    return (
      '<section class="field-view" aria-label="Catalogue field">' +
      '<div class="field-side"><div class="field-head">' +
      '<span class="field-mode"></span>' +
      '<button class="zoom-out" hidden>← All rings</button></div>' +
      '<p class="field-pick" hidden></p>' +
      '<div class="field-stage">' +
      '<canvas class="field-canvas" aria-hidden="true"></canvas>' +
      `${ringLabels}<div class="blip-layer"></div>` +
      '<span class="field-centre" aria-hidden="true">+</span></div>' +
      `<p class="field-legend">${legend}` +
      '<span><i class="key"></i>Chalk</span>' +
      '<span><i class="key washed"></i>Washed black</span>' +
      '<span class="step-hint">← → to step · Esc to zoom out</span></p></div>' +
      '<aside class="contact" aria-label="Contact"></aside></section>'
    );
  }

  /**
   * Wires up the view inside the section markup() produced.
   * @param {{
   *   section: !HTMLElement,
   *   state: !Object<string, string>,
   *   motion: !MediaQueryList,
   *   coord: function(!Piece): string,
   *   linkFor: function(!Piece): string,
   *   getList: function(): !Array<!Piece>,
   *   isVisible: function(!Piece): boolean,
   *   apply: function(),
   * }} options state is the catalogue's state (reads view and ring, writes
   *     ring); motion the prefers-reduced-motion query; coord a piece's
   *     coordinate label; linkFor its product page URL; getList the pieces
   *     in range, sorted; isVisible whether a piece is in range; apply
   *     re-applies the catalogue state (after zooming).
   * @return {{
   *   render: function(),
   *   updateContact: function(),
   *   sync: function(),
   *   includes: function(!Piece): boolean,
   *   blipFor: function(!Piece): (!HTMLElement|undefined),
   *   select: function(!Piece),
   * }}
   */
  function mount(options) {
    const { section, state, motion, coord, linkFor } = options;
    const { getList, isVisible, apply } = options;
    const stage = section.querySelector('.field-stage');
    const modeLabel = section.querySelector('.field-mode');
    const zoomOut = section.querySelector('.zoom-out');
    const pick = section.querySelector('.field-pick');
    const blipLayer = stage.querySelector('.blip-layer');
    const ringButtons = [...stage.querySelectorAll('.ring-label')];
    const coarse = matchMedia('(hover: none)');
    const template = document.createElement('template');
    /** @type {!Map<!Piece, !HTMLElement>} Created on first use. */
    const blips = new Map();
    /** @type {!Map<number, !Object>} */
    const bandCache = new Map();
    let roving = null; // the one blip in the tab order
    let armed = null; // touch: the blip tapped once, which a second tap opens

    /** @type {!FieldLayout} */
    const layout = {
      mode: 'detail',
      zoomRing: -1,
      autoZoom: false,
      ringCounts: [],
      shown: [],
      ringRadius,
      zoomRadii: () => bandsOf(layout.zoomRing).radii,
      pointOf,
      isVisible,
    };
    const contact = catalogueContact.mount({
      panel: section.querySelector('.contact'),
      motion,
      coord,
      linkFor,
      getShown: () => layout.shown,
      blipFor: piece => blips.get(piece),
    });
    const canvas = catalogueRadar.mount({
      stage,
      motion,
      layout,
      isActive: () => state.view === 'field',
      isHidden: () => section.hidden,
      onFirstSize: () => {
        if (state.view === 'field') renderField();
      },
      onPing: (piece, now) => contact.track(piece, now),
    });

    /**
     * A piece's blip, created on first use.
     * @param {!Piece} piece
     * @return {!HTMLElement}
     */
    function blipFor(piece) {
      if (!blips.has(piece)) {
        const collection = esc(collectionData[piece.collection].title);
        const label =
          `${esc(piece.name)}, ${collection}, ${colourOf(piece)}, ` +
          `${coord(piece).replace('°', ' degrees')}, ${money(piece.price)}`;
        const style = at(ringRadius(piece.collection), piece.bearing);
        template.innerHTML =
          `<a class="blip${piece.dark ? ' washed' : ''}" ` +
          `href="${linkFor(piece)}" data-product="${piece.id}" ` +
          `style="${style}" aria-label="${label}"></a>`;
        blips.set(piece, template.content.firstElementChild);
      }
      return blips.get(piece);
    }

    /**
     * How many blips fit on a ring at the radar's current size.
     * @param {number} ring
     * @return {number}
     */
    function ringCapacity(ring) {
      const half = canvas.halfWidth() || 300;
      return Math.floor((Math.PI * 2 * ringRadius(ring) * half) / BLIP_SPACING);
    }

    /**
     * A zoomed ring's bands. Pieces are dealt to bands in bearing order by a
     * smooth weighted round-robin, weighted by each band's circumference, so
     * outer bands take more pieces and spacing stays even. Stable for a ring.
     * @param {number} ring
     * @return {{radii: !Array<number>, bandOf: !Map<!Piece, number>}}
     */
    function bandsOf(ring) {
      if (bandCache.has(ring)) return bandCache.get(ring);
      const pieces = products
        .filter(piece => piece.collection === ring)
        .sort((a, b) => a.bearing - b.bearing);
      const count = Math.min(
        MAX_BANDS,
        Math.max(1, Math.ceil(pieces.length / PIECES_PER_BAND)),
      );
      const radii = Array.from({ length: count }, (_, band) =>
        count === 1 ? 0.62 : 0.3 + (0.5 * band) / (count - 1),
      );
      const total = radii.reduce((sum, radius) => sum + radius, 0);
      const credit = radii.map(() => 0);
      const bandOf = new Map();
      for (const piece of pieces) {
        radii.forEach((radius, band) => {
          credit[band] += radius;
        });
        const band = credit.indexOf(Math.max(...credit));
        credit[band] -= total;
        bandOf.set(piece, band);
      }
      const bands = { radii, bandOf };
      bandCache.set(ring, bands);
      return bands;
    }

    /**
     * A piece's position on the field.
     * @param {!Piece} piece
     * @return {!Array<number>} [left, top] as percentages.
     */
    function pointOf(piece) {
      const angle = (piece.bearing * Math.PI) / 180;
      let radius = ringRadius(piece.collection);
      if (layout.mode === 'zoom') {
        const { radii, bandOf } = bandsOf(piece.collection);
        radius = radii[bandOf.get(piece)];
      }
      return [
        50 + 50 * radius * Math.sin(angle),
        50 - 50 * radius * Math.cos(angle),
      ];
    }

    /** Chooses the level of detail for the pieces in range. */
    function chooseLayout() {
      const list = getList();
      layout.ringCounts = collectionData.map(() => 0);
      for (const piece of list) {
        layout.ringCounts[piece.collection]++;
      }
      let ring = collectionData.findIndex(
        collection => collection.id === state.ring,
      );
      // A ring with no pieces at all can't be zoomed into (e.g. an old
      // ?ring= link).
      if (ring >= 0 && !products.some(piece => piece.collection === ring)) {
        ring = -1;
        state.ring = '';
      }
      const fits =
        list.length <= DETAIL_MAX &&
        layout.ringCounts.every((count, index) => count <= ringCapacity(index));
      layout.autoZoom = false;
      // Too busy, but only one ring in range (e.g. a collection filter):
      // open that ring directly.
      if (ring < 0 && !fits) {
        const busy = layout.ringCounts.flatMap((count, index) =>
          count ? [index] : [],
        );
        if (busy.length === 1) {
          ring = busy[0];
          layout.autoZoom = true;
        }
      }
      layout.zoomRing = ring;
      if (ring >= 0) {
        layout.mode = 'zoom';
      } else {
        layout.mode = fits ? 'detail' : 'summary';
      }
    }

    /** Lays out and draws the field for the pieces in range. */
    function renderField() {
      chooseLayout();
      armed = null;
      pick.hidden = true;
      layout.shown =
        layout.mode === 'summary'
          ? []
          : getList()
              .filter(
                piece =>
                  layout.mode === 'detail' ||
                  piece.collection === layout.zoomRing,
              )
              .sort(catalogueState.byOrbit);
      const elements = layout.shown.map(piece => {
        const blip = blipFor(piece);
        const [left, top] = pointOf(piece);
        blip.style.left = `${left.toFixed(3)}%`;
        blip.style.top = `${top.toFixed(3)}%`;
        blip.tabIndex = -1;
        blip.classList.remove('active', 'ping');
        return blip;
      });
      blipLayer.replaceChildren(...elements);
      // One tab stop for the whole radar; arrow keys move between blips.
      const current = contact.current();
      const focusPiece = layout.shown.includes(current)
        ? current
        : layout.shown[0];
      roving = blips.get(focusPiece) || null;
      if (roving) roving.tabIndex = 0;
      canvas.setTargets(
        layout.shown.map(piece => ({ piece, element: blips.get(piece) })),
      );
      stage.classList.toggle('summary', layout.mode === 'summary');
      stage.classList.toggle('dense', layout.shown.length > DENSE_BLIPS);
      renderRingButtons();
      renderModeLabel();
      zoomOut.hidden = layout.mode !== 'zoom' || layout.autoZoom;
      canvas.repaint();
    }

    /** In summary the ring labels are buttons with counts; else decoration. */
    function renderRingButtons() {
      const summary = layout.mode === 'summary';
      ringButtons.forEach((button, ring) => {
        const count = layout.ringCounts[ring];
        button.hidden = layout.mode === 'zoom';
        button.textContent = pad(ring + 1) + (summary ? ` · ${count}` : '');
        button.disabled = summary && !count;
        button.tabIndex = summary ? 0 : -1;
        if (summary) {
          const title = esc(collectionData[ring].title);
          button.removeAttribute('aria-hidden');
          button.setAttribute(
            'aria-label',
            `Zoom into ${title}, ${count} in range`,
          );
        } else {
          button.setAttribute('aria-hidden', 'true');
          button.removeAttribute('aria-label');
        }
      });
    }

    /** Describes the level of detail above the radar. */
    function renderModeLabel() {
      const ring = layout.zoomRing;
      if (layout.mode === 'zoom') {
        const title = esc(collectionData[ring].title);
        const only = layout.autoZoom ? ' · only ring in range' : '';
        modeLabel.innerHTML =
          `<b>Ring ${pad(ring + 1)} · ${title}</b> · ` +
          `${layout.ringCounts[ring]} in range${only}`;
      } else if (layout.mode === 'summary') {
        const total = getList().length.toLocaleString('en-IN');
        modeLabel.innerHTML =
          `<b>All rings</b> · ${total} in range · ` +
          'too many to plot one by one';
      } else {
        modeLabel.innerHTML = `<b>All rings</b> · ${layout.shown.length} plotted`;
      }
    }

    /**
     * Zooms into a ring, or back out to all rings.
     * @param {number} ring Ring index, or -1 for all rings.
     * @return {number} The ring zoomed into before.
     */
    function zoomTo(ring) {
      const from = layout.zoomRing;
      state.ring = ring >= 0 ? collectionData[ring].id : '';
      apply();
      return from;
    }

    /**
     * Zooms, then moves focus: zooming in lands on the radar's blip, zooming
     * out returns to the ring you came from.
     * @param {number} ring Ring index, or -1 for all rings.
     */
    function zoomAndFocus(ring) {
      const from = zoomTo(ring);
      const back = ringButtons[from];
      const backUsable = back && !back.hidden && !back.disabled;
      const target = ring < 0 && backUsable ? back : roving;
      target?.focus({ preventScroll: true });
    }

    /** After the filters change: keeps the panel on something in range. */
    function updateContact() {
      if (layout.mode === 'summary') {
        contact.showOverview(layout.ringCounts, getList().length);
        return;
      }
      const current = contact.current();
      if (!current || !layout.shown.includes(current)) {
        contact.show(layout.shown[0] || null, 'tracking');
      }
    }

    /**
     * @param {!Element} blip
     * @return {!Piece}
     */
    function pieceOf(blip) {
      return productById(blip.dataset.product);
    }

    /**
     * In summary, a click near a ring zooms into it.
     * @param {!MouseEvent} event
     */
    function zoomToNearestRing(event) {
      if (layout.mode !== 'summary' || event.target.closest('button,a')) return;
      const half = canvas.halfWidth();
      const rect = stage.getBoundingClientRect();
      const distance =
        Math.hypot(
          event.clientX - rect.left - half,
          event.clientY - rect.top - half,
        ) / half;
      let nearest = -1;
      let best = 0.09;
      collectionData.forEach((collection, ring) => {
        const gap = Math.abs(ringRadius(ring) - distance);
        if (gap < best && layout.ringCounts[ring]) {
          best = gap;
          nearest = ring;
        }
      });
      if (nearest >= 0) zoomTo(nearest);
    }

    /**
     * Arrow keys, Home and End step between blips in orbit order; Escape
     * zooms out.
     * @param {!KeyboardEvent} event
     */
    function onStageKey(event) {
      if (
        event.key === 'Escape' &&
        layout.mode === 'zoom' &&
        !layout.autoZoom
      ) {
        event.preventDefault();
        zoomAndFocus(-1);
        return;
      }
      const blip = event.target.closest('.blip');
      const shown = layout.shown;
      if (!blip || !shown.length) return;
      const index = shown.indexOf(pieceOf(blip));
      const next = {
        ArrowRight: index + 1,
        ArrowDown: index + 1,
        ArrowLeft: index - 1,
        ArrowUp: index - 1,
        Home: 0,
        End: shown.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      blips.get(shown[(next + shown.length) % shown.length]).focus();
    }

    /**
     * Touch screens: blips are close together, so the first tap selects (and
     * names the piece just above the radar) and a second tap on the same
     * blip, or "Open", opens it.
     * @param {!MouseEvent} event
     */
    function onTouchTap(event) {
      const blip = event.target.closest('.blip');
      if (!blip || !coarse.matches) return;
      const piece = pieceOf(blip);
      if (armed === piece) return;
      event.preventDefault();
      armed = piece;
      contact.select(piece);
      pick.hidden = false;
      pick.innerHTML =
        `Selected · <b>${esc(piece.name)}</b> · ${coord(piece)} ` +
        `<a href="${linkFor(piece)}">Open ↗</a>`;
    }

    /**
     * Opening the contact (or its blip) morphs the panel's garment into the
     * product page's stage.
     * @param {!MouseEvent} event
     */
    function nameMorph(event) {
      const target = event.target.closest('.contact-open,.blip');
      const tee = section.querySelector('.contact [data-morph]');
      const current = contact.current();
      if (target && tee && current) {
        if (target.getAttribute('href') === linkFor(current)) {
          tee.style.viewTransitionName = 'piece';
        }
      }
    }

    section.addEventListener('click', event => {
      const button = event.target.closest('[data-ring]');
      if (button && !button.disabled) zoomAndFocus(Number(button.dataset.ring));
    });
    zoomOut.addEventListener('click', () => zoomAndFocus(-1));
    stage.addEventListener('click', zoomToNearestRing);
    // Hover or focus selects a piece; it releases back to sweep tracking a
    // moment after you leave.
    stage.addEventListener('pointerover', event => {
      const blip = event.target.closest('.blip');
      if (blip) contact.select(pieceOf(blip));
    });
    stage.addEventListener('pointerout', event => {
      if (event.target.closest('.blip')) contact.release();
    });
    stage.addEventListener('focusin', event => {
      const blip = event.target.closest('.blip');
      if (!blip) return;
      if (roving && roving !== blip) roving.tabIndex = -1;
      roving = blip;
      blip.tabIndex = 0;
      contact.select(pieceOf(blip));
    });
    stage.addEventListener('focusout', () => contact.release());
    stage.addEventListener('keydown', onStageKey);
    stage.addEventListener('click', onTouchTap);
    section.addEventListener('click', nameMorph);

    return {
      render: renderField,
      updateContact,
      sync: canvas.sync,
      includes: piece => layout.shown.includes(piece),
      blipFor: piece => blips.get(piece),
      select: contact.select,
    };
  }

  return { markup, mount };
})();
