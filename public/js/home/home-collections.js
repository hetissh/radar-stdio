/**
 * @fileoverview Homepage collections: one full-height section per collection,
 * each with a horizontal rail of product cards riding a curved orbit.
 * Scrolling the page scans the rail sideways (until the visitor takes over
 * with drag, wheel or keys); the card nearest the centre is "in focus". The
 * canvas behind each rail is home-arcs.js.
 *
 * home.js inserts homeCollections.markup() into the page, then calls
 * homeCollections.mount().
 */

/* exported homeCollections */
/* global esc, escLines, pad, clamp, collectionData, products, productById */
/* global productCard, radarPerf, homeArcs */

/**
 * One collection's rail and its canvas; shared with home-arcs.js.
 * @typedef {Object} HomeRail
 * @property {!Element} section The collection's <section>.
 * @property {number} index The collection's index.
 * @property {!HTMLElement} element The scrolling .clothing-rail.
 * @property {!Array<!HTMLElement>} cards
 * @property {!HTMLCanvasElement} canvas
 * @property {!CanvasRenderingContext2D} context
 * @property {!Array<!Object>} points The dot field (home-arcs.js).
 * @property {!Array<!Object>} ringPoints The arcs' dots (home-arcs.js).
 * @property {!Array<{index: number, born: number}>} echoes
 * @property {number} width Canvas size in CSS pixels.
 * @property {number} height
 * @property {boolean} manual The visitor has scrolled this rail themselves.
 * @property {number} focused Index of the card in focus.
 * @property {number=} radius Orbit geometry, set by home-arcs.js.
 * @property {number=} centerY
 * @property {number=} arcBaseline
 * @property {!Array<!Object>=} foregroundZones
 */

const homeCollections = (() => {
  // Featured pieces per rail; keep in step with RAIL_LIMIT in
  // scripts/build_data.py.
  const RAIL_LIMIT = 12;
  // Pixels a mouse must move before a press becomes a drag.
  const DRAG_THRESHOLD = 6;

  /**
   * A collection's rail: up to RAIL_LIMIT featured pieces in curated order,
   * ending with a "View all" card when the collection is larger. home.json
   * carries only the featured pieces, so the full size comes from its count.
   * @param {number} index Collection index.
   * @return {string} HTML.
   */
  function railCardsHtml(index) {
    const collection = collectionData[index];
    const total = collection.count;
    if (!total) {
      return '<p class="rail-empty mono">No pieces on this orbit yet</p>';
    }
    const shown = products
      .filter(piece => piece.collection === index)
      .sort((a, b) => a.position - b.position)
      .slice(0, RAIL_LIMIT);
    const title = esc(collection.title);
    const viewAll =
      total > shown.length
        ? `<a class="product-card rail-more" ` +
          `href="catalogue.html?collection=${esc(collection.id)}" ` +
          `aria-label="View all ${total} ${title} in the catalogue">` +
          `<div class="garment-space"><span class="signal-tag">ALL / ${total}` +
          '</span><div class="rail-more-mark" aria-hidden="true">' +
          `+${total - shown.length}</div></div>` +
          `<div class="piece-caption"><span>View all ${title}</span>` +
          '<span class="mono">↗</span></div>' +
          `<div class="piece-meta">${total} pieces in the catalogue</div></a>`
        : '';
    return shown.map(productCard).join('') + viewAll;
  }

  /** @return {string} HTML for every collection's section. */
  function markup() {
    return collectionData
      .map((collection, index) => {
        const title = esc(collection.title);
        const featured = pad(Math.min(collection.count, RAIL_LIMIT));
        return (
          `<section class="collection" id="${esc(collection.id)}" ` +
          `aria-labelledby="collection-title-${index}">` +
          '<div class="collection-inner"><div class="collection-heading">' +
          `<div><span class="mono muted">${pad(index + 1)} / COLLECTIONS</span>` +
          `<h2 id="collection-title-${index}">${title}</h2></div>` +
          '<p class="collection-description">' +
          `${escLines(collection.copy)}</p></div>` +
          '<div class="arc-stage">' +
          '<canvas class="arc-field radar-canvas" aria-hidden="true"></canvas>' +
          '<div class="clothing-rail" tabindex="0" role="region" ' +
          `aria-label="${title} clothing cards">${railCardsHtml(index)}</div>` +
          '</div><div class="collection-bottom">' +
          `<span class="field-counter">01 / ${featured}` +
          '<span class="field-progress"></span></span>' +
          '<span class="mono">Scroll to scan · Select a piece</span></div>' +
          '</div></section>'
        );
      })
      .join('');
  }

  /**
   * Wires up the sections markup() produced.
   * @param {{
   *   sections: !Array<!Element>,
   *   motion: !MediaQueryList,
   *   onSync: function(number),
   * }} options sections by collection index; motion is the
   *     prefers-reduced-motion query (no auto-scan); onSync is called after
   *     every scroll sync with the collection in view, or -1.
   */
  function mount({ sections, motion, onSync }) {
    /** @type {!Array<!HomeRail>} */
    const rails = sections.map((section, index) => {
      const canvas = section.querySelector('canvas');
      return {
        section,
        index,
        element: section.querySelector('.clothing-rail'),
        cards: [...section.querySelectorAll('.product-card')],
        canvas,
        context: canvas.getContext('2d'),
        points: [],
        ringPoints: [],
        echoes: [],
        width: 0,
        height: 0,
        manual: false,
        focused: 0,
      };
    });
    const arcs = homeArcs.mount({ rails, motion });
    let lastPageY = scrollY;

    /**
     * Places each card on the arc: raised onto it, and scaled and dimmed by
     * its distance from the centre.
     * @param {!HomeRail} rail
     * @return {number} The index of the card nearest the centre.
     */
    function placeCards(rail) {
      const element = rail.element;
      const center = element.scrollLeft + element.clientWidth / 2;
      let closest = 0;
      let nearest = Infinity;
      rail.cards.forEach((card, index) => {
        const offset = card.offsetLeft + card.offsetWidth / 2 - center;
        if (Math.abs(offset) < nearest) {
          nearest = Math.abs(offset);
          closest = index;
        }
        const normalized = offset / Math.max(300, element.clientWidth * 0.5);
        const distance = Math.abs(normalized);
        const scale = motion.matches
          ? 1
          : 1.025 - Math.min(0.095, distance * 0.05);
        const garment = card.querySelector('.garment-space');
        const garmentOffset =
          garment.offsetTop + garment.offsetHeight / 2 - card.offsetHeight / 2;
        // Anchor the garment's centre, rather than the card (which includes
        // its caption).
        const rise =
          arcs.orbitY(rail, offset) -
          element.clientHeight / 2 -
          scale * garmentOffset;
        card.style.setProperty('--rise', `${rise}px`);
        card.style.setProperty('--scale', String(scale));
        card.style.setProperty(
          '--visibility',
          String(1 - Math.min(0.2, distance * 0.12)),
        );
        card.style.setProperty(
          '--focus-light',
          String(1 - Math.min(0.3, distance * 0.2)),
        );
      });
      return closest;
    }

    /**
     * Labels each card "NN / SIGNAL", and the one in focus "NN / IN FOCUS".
     * @param {!HomeRail} rail
     * @param {number} focused
     */
    function labelCards(rail, focused) {
      rail.cards.forEach((card, index) => {
        if (card.classList.contains('rail-more')) return;
        const state = index === focused ? ' / IN FOCUS' : ' / SIGNAL';
        card.querySelector('.signal-tag').textContent = pad(index + 1) + state;
      });
    }

    /**
     * Measures where the visible cards are, for the canvas to fade under.
     * @param {!HomeRail} rail
     * @return {!Array<!Object>} Zones, as home-arcs.js setForeground() takes.
     */
    function measureCards(rail) {
      const stage = rail.canvas.getBoundingClientRect();
      const zones = [];
      for (const card of rail.cards) {
        const garment = card
          .querySelector('.garment-space')
          .getBoundingClientRect();
        if (garment.right < stage.left || garment.left > stage.right) continue;
        const caption = card
          .querySelector('.piece-caption')
          .getBoundingClientRect();
        const meta = card.querySelector('.piece-meta').getBoundingClientRect();
        zones.push({
          x: (garment.left + garment.right) / 2 - stage.left,
          y: (garment.top + garment.bottom) / 2 - stage.top,
          rx: garment.width * 0.62,
          ry: garment.height * 0.66,
          left: caption.left - stage.left - 6,
          right: caption.right - stage.left + 6,
          top: caption.top - stage.top - 4,
          bottom: meta.bottom - stage.top + 8,
        });
      }
      return zones;
    }

    /**
     * Shows "focused / total" and the progress bar. A closing "View all"
     * card is not a piece, so it isn't counted.
     * @param {!HomeRail} rail
     * @param {number} focused
     */
    function updateCounter(rail, focused) {
      const counter = rail.section.querySelector('.field-counter');
      const cards = rail.cards;
      const endsWithViewAll =
        cards[cards.length - 1].classList.contains('rail-more');
      const pieceCount = cards.length - (endsWithViewAll ? 1 : 0);
      counter.firstChild.textContent = `${pad(Math.min(focused + 1, pieceCount))} / ${pad(pieceCount)}`;
      counter.style.setProperty('--progress', (focused + 1) / cards.length);
    }

    /**
     * Re-lays a rail after it moves: places the cards, moves the focus and
     * tells the canvas where the cards now are.
     * @param {!HomeRail} rail
     */
    function layoutCards(rail) {
      const layoutStart = performance.now();
      if (!rail.cards.length) {
        rail.foregroundZones = [];
        rail.section.querySelector('.field-counter').firstChild.textContent =
          '00 / 00';
        return;
      }
      // Focus and locator scrolling must not push the rail off its orbit.
      if (rail.element.scrollTop) rail.element.scrollTop = 0;
      const closest = placeCards(rail);
      if (closest !== rail.focused) arcs.addEcho(rail, rail.focused);
      rail.focused = closest;
      labelCards(rail, closest);
      arcs.setForeground(rail, measureCards(rail));
      updateCounter(rail, closest);
      radarPerf?.record('rail layout', performance.now() - layoutStart);
    }

    /**
     * On scroll: finds the collection in view, scans each rail to match the
     * page's progress through its section, and re-lays the visible rails.
     */
    function syncCollections() {
      const pageMoved = Math.abs(scrollY - lastPageY) > 1;
      lastPageY = scrollY;
      let current = -1;
      for (const rail of rails) {
        const rect = rail.section.getBoundingClientRect();
        const inView =
          rect.top < innerHeight * 0.6 && rect.bottom > innerHeight * 0.5;
        if (inView) current = rail.index;
        // Scrolling the page hands the rail back to the automatic scan.
        if (pageMoved) rail.manual = false;
        if (!rail.manual && !motion.matches) scanWithPage(rail, rect);
        if (rect.top < innerHeight && rect.bottom > 0) layoutCards(rail);
      }
      arcs.setActive(current);
      onSync(current);
      arcs.schedule();
    }

    /**
     * Scrolls a rail sideways in step with the page's progress through its
     * section.
     * @param {!HomeRail} rail
     * @param {!DOMRect} rect The section's position.
     */
    function scanWithPage(rail, rect) {
      const element = rail.element;
      const progress = clamp(
        -rect.top / Math.max(1, rect.height - innerHeight),
        0,
        1,
      );
      const goal = progress * (element.scrollWidth - element.clientWidth);
      if (Math.abs(element.scrollLeft - goal) > 1) element.scrollLeft = goal;
    }

    /**
     * Mouse drag scrolls the rail; a drag must not also open the card it
     * started on.
     * @param {!HomeRail} rail
     */
    function enableDrag(rail) {
      const element = rail.element;
      let drag = null;
      let suppressClick = false;
      element.addEventListener(
        'pointerdown',
        event => {
          rail.manual = true;
          if (event.pointerType !== 'mouse') return;
          drag = {
            id: event.pointerId,
            x: event.clientX,
            left: element.scrollLeft,
            moved: false,
          };
          suppressClick = false;
        },
        { passive: true },
      );
      element.addEventListener('pointermove', event => {
        if (!drag) return;
        const dx = event.clientX - drag.x;
        if (Math.abs(dx) > DRAG_THRESHOLD) {
          drag.moved = true;
          element.setPointerCapture(drag.id);
        }
        if (drag.moved) {
          event.preventDefault();
          element.scrollLeft = drag.left - dx;
          suppressClick = true;
        }
      });
      const release = () => {
        if (drag && element.hasPointerCapture(drag.id)) {
          element.releasePointerCapture(drag.id);
        }
        drag = null;
      };
      element.addEventListener('pointerup', release);
      element.addEventListener('pointercancel', release);
      element.addEventListener(
        'click',
        event => {
          if (!suppressClick) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClick = false;
        },
        true,
      );
    }

    /**
     * Arrow keys step the rail one card at a time.
     * @param {!HomeRail} rail
     */
    function enableKeys(rail) {
      rail.element.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        if (rail.cards.length < 2) return;
        event.preventDefault();
        rail.manual = true;
        const step = rail.cards[1].offsetLeft - rail.cards[0].offsetLeft;
        rail.element.scrollBy({
          left: (event.key === 'ArrowRight' ? 1 : -1) * step,
          behavior: motion.matches ? 'instant' : 'smooth',
        });
      });
    }

    /**
     * Returning from a product page (?piece=ID) lands with that piece in
     * focus on its orbit. The homepage only loads featured pieces; a piece
     * beyond them lands on its rail's "View all" card.
     */
    function returnToPiece() {
      const params = new URLSearchParams(location.search);
      const piece = productById(params.get('piece') || '');
      const ring = piece
        ? piece.collection
        : collectionData.findIndex(
            collection => collection.id === params.get('collection'),
          );
      if (!params.has('piece') || ring < 0) return;
      requestAnimationFrame(() => {
        // Find the card by id (positions may have gaps).
        const rail = rails[ring];
        const card =
          (piece &&
            rail.cards.find(each => each.dataset.product === piece.id)) ||
          rail.cards[rail.cards.length - 1];
        if (!card) return;
        const element = rail.element;
        const span = Math.max(1, element.scrollWidth - element.clientWidth);
        const goal = clamp(
          card.offsetLeft + card.offsetWidth / 2 - element.clientWidth / 2,
          0,
          span,
        );
        const top = rail.section.getBoundingClientRect().top + scrollY;
        if (motion.matches) {
          scrollTo({ top, behavior: 'instant' });
          rail.manual = true;
          element.scrollLeft = goal;
        } else {
          // The page's scroll position drives the rail's scan, so scroll the
          // page to where the scan shows the card.
          const scanDistance = rail.section.offsetHeight - innerHeight;
          scrollTo({
            top: top + (goal / span) * scanDistance,
            behavior: 'instant',
          });
        }
        history.replaceState(
          null,
          '',
          `${location.pathname}#${collectionData[ring].id}`,
        );
        syncCollections();
      });
    }

    for (const rail of rails) {
      new ResizeObserver(() => {
        arcs.resize(rail);
        layoutCards(rail);
        arcs.schedule();
      }).observe(rail.section.querySelector('.arc-stage'));
      rail.element.addEventListener('scroll', () => layoutCards(rail), {
        passive: true,
      });
      rail.element.addEventListener(
        'wheel',
        event => {
          if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
            rail.manual = true;
          }
        },
        { passive: true },
      );
      enableDrag(rail);
      enableKeys(rail);
    }
    addEventListener('scroll', syncCollections, { passive: true });
    addEventListener('resize', syncCollections);
    motion.addEventListener('change', () => {
      arcs.stop();
      rails.forEach(rail => layoutCards(rail));
      syncCollections();
    });
    syncCollections();
    returnToPiece();
  }

  return { markup, mount };
})();
