// Product page: one piece, located on its collection's orbit. The radar sweeps once, slows and locks onto it
// (product-lock.js); its views, photos and films play on the stage (product-media.js); a size is chosen on
// concentric rings and added to the concept bag (product-sizes.js). Below: neighbours on the orbit.
// Catalogue data (loaded per piece), theme, concept bag and header menu come from shared.js.
(async () => {
  const buildStart = performance.now();
  const main = document.querySelector('#piece');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const query = new URLSearchParams(location.search);

  // Loads this piece in full and its collection's summaries; null if there is no such piece.
  let p;
  try {
    p = await radarData.piece(query.get('id') || '');
  } catch (error) {
    console.error(error);
    document.title = 'Signal interrupted — RADAR STUDIO';
    showLoadError(main, 'this piece');
    return;
  }
  radarPerf?.record('product data', performance.now() - buildStart);

  if (!p) {
    document.title = 'Signal lost — RADAR STUDIO';
    main.innerHTML =
      '<section class="signal-lost"><span class="mono muted">No signal / 404</span><h1>Signal lost</h1>' +
      '<p>There is no piece at this coordinate.</p><a class="mono" href="index.html#collections">← Back to collections</a></section>';
    return;
  }

  const ORBIT_WINDOW = 5; // a large collection's orbit shows this piece and this many either side
  const MORE_LIMIT = 12; // pieces in the "More on this orbit" rail

  // ---------- Where the piece sits ----------

  const collection = collectionData[p.collection];
  // Positions give the curated order but may have gaps (a piece removed), so the rank in the sorted list is the index.
  const siblings = products
    .filter(x => x.collection === p.collection)
    .sort((a, b) => a.position - b.position);
  const count = siblings.length;
  const index = siblings.indexOf(p);
  const rank = s => siblings.indexOf(s) + 1;
  // The sibling `offset` places along the orbit from this piece, wrapping around.
  const around = offset => siblings[(index + offset + count) % count];
  const prev = around(-1);
  const next = around(1);
  // The ring matches the homepage locator.
  const ring = pad(p.collection + 1);

  // ---------- Links ----------

  // No hash: the homepage positions itself on the piece without a competing anchor jump.
  const backUrl = `index.html?piece=${p.id}&collection=${collection.id}`;
  // Arriving from the catalogue keeps that context: links carry it on and the crumb returns to the same view and filters.
  const fromCatalogue = query.get('from') === 'catalogue';
  const link = s => productUrl(s) + (fromCatalogue ? '&from=catalogue' : '');
  const catalogueUrl = (() => {
    const saved = new URLSearchParams(
      sessionStore.get(STORAGE_KEYS.catalogue) || '',
    );
    saved.set('piece', p.id);
    return `catalogue.html?${saved}`;
  })();

  document.title = `${p.name} — RADAR STUDIO`;
  const crumb = document.querySelector('.crumb');
  if (fromCatalogue) {
    crumb.href = catalogueUrl;
    crumb.textContent = '← Catalogue';
  } else {
    crumb.href = backUrl;
    crumb.innerHTML = `← <span class="crumb-trail">Collections / </span>${esc(collection.title)}`;
  }

  // ---------- Markup ----------

  const priceHtml = reduced(p)
    ? `<del>${money(p.original)}</del><span>${money(p.price)}</span>${
        collection.id === 'end-of-season'
          ? '<span class="muted">End of season</span>'
          : ''
      }`
    : `<span>${money(p.price)}</span>`;

  const readout = [
    ['Colour', colourOf(p)],
    ['Shape', 'Relaxed · heavy cotton'],
    ['Artwork', p.title],
    ['Discipline', p.discipline],
    ['Category', p.category],
    ['Bearing', `${bearingLabel(p)}° / Ring ${ring}`],
    ['Source', 'Supplied reference'],
  ];
  const readoutHtml = readout
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');

  // Pieces sit along a shallow arc, echoing the collection orbit on the homepage.
  /**
   *
   */
  function orbitArcHtml() {
    const windowed = count > ORBIT_WINDOW * 2 + 1;
    const pieces = windowed
      ? Array.from({ length: ORBIT_WINDOW * 2 + 1 }, (_, k) =>
          around(k - ORBIT_WINDOW),
        )
      : siblings;
    const slots = pieces.length;
    // Slot i's point on a 300-unit-radius arc spanning 50°; fractional slots extend past the ends.
    const point = i => {
      const a = ((slots < 2 ? 0 : i / (slots - 1) - 0.5) * 50 * Math.PI) / 180;
      return [150 + 300 * Math.sin(a), 330 - 300 * Math.cos(a)];
    };
    const xy = ([x, y]) => `cx="${x.toFixed(1)}" cy="${y.toFixed(1)}"`;
    const [x0, y0] = point(-0.35);
    const [x1, y1] = point(slots - 1 + 0.35);
    // A windowed orbit continues past both ends: show "···" there.
    const more = i => {
      const [x, y] = point(i);
      return `<text class="arc-more" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" aria-hidden="true">···</text>`;
    };
    const ends = windowed ? more(-0.9) + more(slots - 1 + 0.9) : '';
    const dots = pieces
      .map((s, i) => {
        const at = xy(point(i));
        const current = s === p;
        return `<a role="listitem" href="${link(s)}" aria-label="${pad(rank(s))} ${esc(s.name)}"${
          current ? ' aria-current="page" class="current"' : ''
        }><circle class="hit" ${at} r="11"/>${
          current ? `<circle class="halo" ${at} r="9" pathLength="24"/>` : ''
        }<circle class="dot" ${at} r="${current ? 4 : 2.6}"/></a>`;
      })
      .join('');
    return (
      `<svg class="orbit-arc" viewBox="0 0 300 70" role="list">` +
      `<path class="arc-path" d="M${x0.toFixed(1)} ${y0.toFixed(1)} A300 300 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" pathLength="90"/>${
        ends
      }${dots}</svg>`
    );
  }

  // "More on this orbit": the nearest pieces around this one (half after, half before), in orbit order.
  const half = MORE_LIMIT / 2;
  const nearby =
    count - 1 <= MORE_LIMIT
      ? siblings.filter(s => s !== p)
      : [
          ...Array.from({ length: half }, (_, k) => around(k - half)),
          ...Array.from({ length: half }, (_, k) => around(k + 1)),
        ];
  const viewAllHtml =
    nearby.length < count - 1
      ? `<a class="mono" href="catalogue.html?collection=${collection.id}">View all ${count} in the catalogue ↗</a>`
      : `<a class="mono" href="${backUrl}">View all ${esc(collection.title)} ↗</a>`;

  const stageHtml =
    `<section class="piece-stage" aria-label="${esc(p.name)}, garment view">` +
    `<canvas class="lock-field" aria-hidden="true"></canvas>` +
    `<div class="lock-readout mono" aria-hidden="true"><span class="lock-state">Scanning 000%</span>` +
    `<span>BRG ${bearingLabel(p)}° / R${ring}</span><span>${pad(index + 1)} / ${pad(count)}</span>` +
    `<span class="media-state"></span></div>` +
    `<div class="garment-space piece-garment"><div class="tee-view">` +
    `<div class="concept-tee ${p.dark ? 'dark' : ''}">${art(
      { ...p, title: `Artwork: ${p.title}` },
      {
        className: 'tee-art',
        eager: true,
        sizes: '(max-width: 900px) 40vw, 300px',
      },
    )}<img class="neck-mark" src="assets/radar-logo-updated.png" alt=""></div></div></div>${productMedia.markup(
      p,
    )}</section>`;

  const infoHtml =
    `<section class="piece-info" aria-labelledby="piece-title">` +
    `<p class="piece-kicker mono muted">${ring} / ${esc(collection.title)} · ${pad(index + 1)} of ${pad(count)}</p>` +
    `<h1 id="piece-title">${esc(p.name)}</h1>` +
    `<p class="piece-price mono">${priceHtml}</p>${productSizes.markup()}<dl class="readout">${readoutHtml}</dl>` +
    `<div class="signal-notes"><h2 class="mono muted">Signal notes</h2><p>${esc(p.description)}</p>` +
    `<p class="mono muted">${esc(p.status)}<br>Illustrative garment / sample price</p></div>` +
    `</section>`;

  const orbitNavHtml =
    `<nav class="orbit-nav" aria-label="Pieces in ${esc(collection.title)}">` +
    `<a class="orbit-step prev" href="${link(prev)}"><span class="mono muted">← ${pad(rank(prev))}</span><span>${esc(prev.name)}</span></a>${orbitArcHtml()}<a class="orbit-step next" href="${link(next)}"><span class="mono muted">${pad(rank(next))} →</span><span>${esc(next.name)}</span></a>` +
    `</nav>`;

  const moreHtml =
    `<section class="more-orbit" aria-labelledby="more-title">` +
    `<div class="more-head"><h2 id="more-title" class="mono">More on this orbit</h2>${viewAllHtml}</div>` +
    `<div class="more-rail" tabindex="0" role="region" aria-label="More from ${esc(collection.title)}">${nearby
      .map(productCard)
      .join('')}</div></section>`;

  main.innerHTML = `<div class="piece-hero">${stageHtml}${infoHtml}</div>${orbitNavHtml}${moreHtml}`;
  if (fromCatalogue) {
    main.querySelectorAll('.more-rail .product-card').forEach(card => {
      card.href = link(productById(card.dataset.product));
    });
  }

  // ---------- Behaviour ----------

  const stage = main.querySelector('.piece-stage');
  productLock.mount({
    stage,
    centre: stage.querySelector('.tee-view'),
    art: stage.querySelector('.tee-art'),
    bearing: bearingOf(p),
    number: pad(index + 1),
    motion,
  });
  productSizes.mount({ root: main, piece: p });
  productMedia.mount({ stage, piece: p, motion });

  // Arrow keys move along the orbit when nothing else has focus.
  document.addEventListener('keydown', event => {
    if (
      document.activeElement !== document.body ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    ) {
      return;
    }
    if (event.key === 'ArrowLeft') location.href = link(prev);
    if (event.key === 'ArrowRight') location.href = link(next);
  });

  radarPerf?.record('product build', performance.now() - buildStart);
})();
