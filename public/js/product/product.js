/**
 * @fileoverview The product page: one piece, located on its collection's
 * orbit. The radar sweeps once, slows and locks onto it (product-lock.js);
 * its views, photos and films play on the stage (product-media.js, with the
 * lens in product-lens.js); a size is chosen on concentric rings and added to
 * the concept bag (product-sizes.js). Below: its neighbours on the orbit.
 */

/* global esc, pad, money, reduced, colourOf, art, productUrl, productCard */
/* global productById, bearingLabel, collectionData, products, radarData */
/* global radarPerf, showLoadError, STORAGE_KEYS, sessionStore */
/* global productLock, productMedia, productSizes */

(async () => {
  const buildStart = performance.now();
  const main = document.querySelector('#piece');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const query = new URLSearchParams(location.search);

  // Loads this piece in full and its collection's summaries.
  let piece;
  try {
    piece = await radarData.piece(query.get('id') || '');
  } catch (error) {
    console.error(error);
    document.title = 'Signal interrupted — RADAR STUDIO';
    showLoadError(main, 'this piece');
    return;
  }
  radarPerf?.record('product data', performance.now() - buildStart);

  if (!piece) {
    document.title = 'Signal lost — RADAR STUDIO';
    main.innerHTML =
      '<section class="signal-lost"><span class="mono muted">No signal / 404' +
      '</span><h1>Signal lost</h1><p>There is no piece at this coordinate.</p>' +
      '<a class="mono" href="index.html#collections">← Back to collections</a>' +
      '</section>';
    return;
  }

  // A large collection's orbit shows this piece and this many either side.
  const ORBIT_WINDOW = 5;
  // Pieces in the "More on this orbit" rail.
  const MORE_LIMIT = 12;

  const collection = collectionData[piece.collection];
  const collectionTitle = esc(collection.title);
  // Positions give the curated order but may have gaps (a piece removed), so
  // a piece's rank is its place in the sorted list.
  const siblings = products
    .filter(other => other.collection === piece.collection)
    .sort((a, b) => a.position - b.position);
  const count = siblings.length;
  const index = siblings.indexOf(piece);
  const rank = sibling => siblings.indexOf(sibling) + 1;
  /**
   * @param {number} offset Places along the orbit; negative is backwards.
   * @return {!Piece} The sibling that far from this piece, wrapping around.
   */
  const around = offset => siblings[(index + offset + count) % count];
  const previous = around(-1);
  const next = around(1);
  // The ring number matches the homepage locator.
  const ring = pad(piece.collection + 1);

  // No hash: the homepage positions itself on the piece without a competing
  // anchor jump.
  const backUrl = `index.html?piece=${piece.id}&collection=${collection.id}`;
  // Arriving from the catalogue keeps that context: links carry it on, and
  // the crumb returns to the same view and filters.
  const fromCatalogue = query.get('from') === 'catalogue';
  /**
   * @param {!Piece} sibling
   * @return {string} Its product page URL, keeping the catalogue context.
   */
  const link = sibling =>
    productUrl(sibling) + (fromCatalogue ? '&from=catalogue' : '');

  /** @return {string} The catalogue URL the visitor came from. */
  function catalogueUrl() {
    const saved = sessionStore.get(STORAGE_KEYS.catalogue) || '';
    const params = new URLSearchParams(saved);
    params.set('piece', piece.id);
    return `catalogue.html?${params}`;
  }

  document.title = `${piece.name} — RADAR STUDIO`;
  const crumb = document.querySelector('.crumb');
  if (fromCatalogue) {
    crumb.href = catalogueUrl();
    crumb.textContent = '← Catalogue';
  } else {
    crumb.href = backUrl;
    crumb.innerHTML = `← <span class="crumb-trail">Collections / </span>${collectionTitle}`;
  }

  /** @return {string} The price, with the original when reduced. */
  function priceHtml() {
    const price = `<span>${money(piece.price)}</span>`;
    if (!reduced(piece)) return price;
    const endOfSeason =
      collection.id === 'end-of-season'
        ? '<span class="muted">End of season</span>'
        : '';
    return `<del>${money(piece.original)}</del>${price}${endOfSeason}`;
  }

  /** @return {string} The piece's details as a definition list's rows. */
  function readoutHtml() {
    const readout = [
      ['Colour', colourOf(piece)],
      ['Shape', 'Relaxed · heavy cotton'],
      ['Artwork', piece.title],
      ['Discipline', piece.discipline],
      ['Category', piece.category],
      ['Bearing', `${bearingLabel(piece)}° / Ring ${ring}`],
      ['Source', 'Supplied reference'],
    ];
    return readout
      .map(
        ([term, value]) =>
          `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`,
      )
      .join('');
  }

  /**
   * The orbit navigation's arc: pieces sit along a shallow arc, echoing the
   * collection orbit on the homepage. A large collection shows a window of
   * it, with "···" past both ends.
   * @return {string} An <svg> with one link per piece.
   */
  function orbitArcHtml() {
    const windowed = count > ORBIT_WINDOW * 2 + 1;
    const pieces = windowed
      ? Array.from({ length: ORBIT_WINDOW * 2 + 1 }, (_, i) =>
          around(i - ORBIT_WINDOW),
        )
      : siblings;
    const slots = pieces.length;
    // Slot i's point on a 300-unit-radius arc spanning 50°; fractional slots
    // reach past the ends.
    const point = slot => {
      const fraction = slots < 2 ? 0 : slot / (slots - 1) - 0.5;
      const angle = (fraction * 50 * Math.PI) / 180;
      return [150 + 300 * Math.sin(angle), 330 - 300 * Math.cos(angle)];
    };
    const centre = ([x, y]) => `cx="${x.toFixed(1)}" cy="${y.toFixed(1)}"`;
    const ellipsis = slot => {
      const [x, y] = point(slot);
      return (
        `<text class="arc-more" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" ` +
        'aria-hidden="true">···</text>'
      );
    };
    const [startX, startY] = point(-0.35);
    const [endX, endY] = point(slots - 1 + 0.35);
    const path =
      `M${startX.toFixed(1)} ${startY.toFixed(1)} ` +
      `A300 300 0 0 1 ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    const ends = windowed ? ellipsis(-0.9) + ellipsis(slots - 1 + 0.9) : '';
    const dots = pieces
      .map((sibling, slot) => {
        const at = centre(point(slot));
        const current = sibling === piece;
        const currentAttrs = current
          ? ' aria-current="page" class="current"'
          : '';
        const halo = current
          ? `<circle class="halo" ${at} r="9" pathLength="24"/>`
          : '';
        return (
          `<a role="listitem" href="${link(sibling)}" ` +
          `aria-label="${pad(rank(sibling))} ${esc(sibling.name)}"` +
          `${currentAttrs}><circle class="hit" ${at} r="11"/>${halo}` +
          `<circle class="dot" ${at} r="${current ? 4 : 2.6}"/></a>`
        );
      })
      .join('');
    return (
      '<svg class="orbit-arc" viewBox="0 0 300 70" role="list">' +
      `<path class="arc-path" d="${path}" pathLength="90"/>${ends}${dots}</svg>`
    );
  }

  /**
   * "More on this orbit": the nearest pieces around this one (half after,
   * half before), in orbit order.
   * @return {!Array<!Piece>}
   */
  function nearbyPieces() {
    if (count - 1 <= MORE_LIMIT) {
      return siblings.filter(other => other !== piece);
    }
    const half = MORE_LIMIT / 2;
    const before = Array.from({ length: half }, (_, i) => around(i - half));
    const after = Array.from({ length: half }, (_, i) => around(i + 1));
    return [...before, ...after];
  }

  /** @return {string} The stage: radar, readout, garment and media. */
  function stageHtml() {
    const artwork = art(
      { ...piece, title: `Artwork: ${piece.title}` },
      {
        className: 'tee-art',
        eager: true,
        sizes: '(max-width: 900px) 40vw, 300px',
      },
    );
    return (
      `<section class="piece-stage" aria-label="${esc(piece.name)}, garment view">` +
      '<canvas class="lock-field radar-canvas" aria-hidden="true"></canvas>' +
      '<div class="lock-readout mono" aria-hidden="true">' +
      '<span class="lock-state">Scanning 000%</span>' +
      `<span>BRG ${bearingLabel(piece)}° / R${ring}</span>` +
      `<span>${pad(index + 1)} / ${pad(count)}</span>` +
      '<span class="media-state"></span></div>' +
      '<div class="garment-space piece-garment"><div class="tee-view">' +
      `<div class="concept-tee ${piece.dark ? 'dark' : ''}">${artwork}` +
      '<img class="neck-mark" src="assets/radar-logo-updated.png" alt="">' +
      '</div></div></div>' +
      `${productMedia.markup(piece)}</section>`
    );
  }

  /** @return {string} The details column. */
  function infoHtml() {
    return (
      `<section class="piece-info" aria-labelledby="piece-title">` +
      `<p class="piece-kicker mono muted">${ring} / ${collectionTitle} · ` +
      `${pad(index + 1)} of ${pad(count)}</p>` +
      `<h1 id="piece-title">${esc(piece.name)}</h1>` +
      `<p class="piece-price mono">${priceHtml()}</p>${productSizes.markup()}<dl class="readout">${readoutHtml()}</dl>` +
      `<div class="signal-notes"><h2 class="mono muted">Signal notes</h2>` +
      `<p>${esc(piece.description)}</p>` +
      `<p class="mono muted">${esc(piece.status)}<br>` +
      `Illustrative garment / sample price</p></div></section>`
    );
  }

  /** @return {string} Previous and next pieces, either side of the arc. */
  function orbitNavHtml() {
    return (
      `<nav class="orbit-nav" aria-label="Pieces in ${collectionTitle}">` +
      `<a class="orbit-step prev" href="${link(previous)}">` +
      `<span class="mono muted">← ${pad(rank(previous))}</span>` +
      `<span>${esc(previous.name)}</span></a>${orbitArcHtml()}` +
      `<a class="orbit-step next" href="${link(next)}">` +
      `<span class="mono muted">${pad(rank(next))} →</span>` +
      `<span>${esc(next.name)}</span></a></nav>`
    );
  }

  /** @return {string} The "More on this orbit" rail. */
  function moreHtml() {
    const nearby = nearbyPieces();
    const viewAll =
      nearby.length < count - 1
        ? `<a class="mono" href="catalogue.html?collection=${collection.id}">` +
          `View all ${count} in the catalogue ↗</a>`
        : `<a class="mono" href="${backUrl}">View all ${collectionTitle} ↗</a>`;
    return (
      '<section class="more-orbit" aria-labelledby="more-title">' +
      '<div class="more-head">' +
      `<h2 id="more-title" class="mono">More on this orbit</h2>${viewAll}</div>` +
      '<div class="more-rail" tabindex="0" role="region" ' +
      `aria-label="More from ${collectionTitle}">` +
      `${nearby.map(productCard).join('')}</div></section>`
    );
  }

  main.innerHTML = `<div class="piece-hero">${stageHtml()}${infoHtml()}</div>${orbitNavHtml()}${moreHtml()}`;
  if (fromCatalogue) {
    main.querySelectorAll('.more-rail .product-card').forEach(card => {
      card.href = link(productById(card.dataset.product));
    });
  }

  const stage = main.querySelector('.piece-stage');
  productLock.mount({
    stage,
    centre: stage.querySelector('.tee-view'),
    art: stage.querySelector('.tee-art'),
    bearing: piece.bearing,
    number: pad(index + 1),
    motion,
  });
  productSizes.mount({ root: main, piece });
  productMedia.mount({ stage, piece, motion });

  // Arrow keys move along the orbit when nothing else has focus.
  document.addEventListener('keydown', event => {
    const modified = event.altKey || event.metaKey || event.ctrlKey;
    if (document.activeElement !== document.body || modified) return;
    if (event.key === 'ArrowLeft') location.href = link(previous);
    if (event.key === 'ArrowRight') location.href = link(next);
  });

  radarPerf?.record('product build', performance.now() - buildStart);
})();
