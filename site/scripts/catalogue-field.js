// Catalogue field view: every piece in range plotted on one radar, at the coordinate its product page reports
// (ring = collection, bearing = place on that orbit), beside a contact panel describing one piece.
//
// Levels of detail:
//   detail  – every piece in range is a blip on its collection ring (while each ring has room).
//   summary – too many to plot one by one: rings show density and counts, and you zoom into one.
//   zoom    – one collection fills the radar. Bearings are kept; pieces alternate across a few bands.
// Only pieces in range get a link (a blip); filtered-out pieces are faint canvas dots, so the page stays light.
//
// The contact panel follows what the sweep finds, unless the visitor hovers, focuses or taps a blip.
//
// Classic script (see shared.js): defines the global `catalogueField`. Uses shared.js and radar.js.
// catalogue.js owns the filters and state, inserts catalogueField.markup(), then drives the view through the
// controller returned by catalogueField.mount().
const catalogueField = (() => {
  const DETAIL_MAX = 150; // more pieces in range than this switches to summary
  const BLIP_SPACING = 14; // px of ring circumference each blip needs
  const DENSE_BLIPS = 60; // above this many blips, they are drawn smaller
  const SWEEP_WIDTH = 1.4; // radians of afterglow behind the sweep line
  const SWEEP_SPEED = (18 * Math.PI) / 180; // radians per second
  const TRACK_INTERVAL_MS = 1700; // fastest the contact panel moves from piece to piece while tracking
  const RELEASE_MS = 2500; // a hover or focus selection holds this long after the pointer or focus leaves

  // Ring radii as a fraction of the field's half-width; R01 is innermost, as on the homepage locator.
  const ringRadius = k => ((k + 1.4) / 4.4) * 0.8;

  // CSS position for a point `fraction` of the half-width from the centre, at a compass bearing in degrees.
  function at(fraction, degrees) {
    const a = (degrees * Math.PI) / 180;
    const left = (50 + 50 * fraction * Math.sin(a)).toFixed(3);
    const top = (50 - 50 * fraction * Math.cos(a)).toFixed(3);
    return `left:${left}%;top:${top}%`;
  }

  function markup() {
    const ringLabels = collectionData
      .map(
        (c, k) =>
          `<button class="ring-label" data-ring="${esc(k)}" style="${at(ringRadius(k), 22.5)}">${pad(k + 1)}</button>`,
      )
      .join('');
    const legend = collectionData.map((c, k) => `<span>${pad(k + 1)} ${esc(c.title)}</span>`).join('');
    return (
      '<section class="field-view" aria-label="Catalogue field"><div class="field-side">' +
      '<div class="field-head"><span class="field-mode"></span><button class="zoom-out" hidden>← All rings</button></div>' +
      '<p class="field-pick" hidden></p>' +
      `<div class="field-stage"><canvas class="field-canvas" aria-hidden="true"></canvas>${ringLabels}` +
      '<div class="blip-layer"></div><span class="field-centre" aria-hidden="true">+</span></div>' +
      `<p class="field-legend">${legend}<span><i class="key"></i>Chalk</span>` +
      '<span><i class="key washed"></i>Washed black</span>' +
      '<span class="step-hint">← → to step · Esc to zoom out</span></p></div>' +
      '<aside class="contact" aria-label="Contact"></aside></section>'
    );
  }

  // Wire up the view inside `section` (the element markup() produced).
  //   state      the catalogue's shared state object; reads view and ring, writes ring
  //   motion     the prefers-reduced-motion media query
  //   coord(p)   a piece's coordinate label, e.g. "R02 / 045°"
  //   linkFor(p) a piece's product page URL from the catalogue
  //   byOrbit    sort comparator for orbit order
  //   getList()  the pieces currently in range, in the chosen sort order
  //   isVisible(p) whether a piece is in range
  //   apply()    re-applies the catalogue state (called after zooming)
  function mount({ section, state, motion, coord, linkFor, byOrbit, getList, isVisible, apply }) {
    const stage = section.querySelector('.field-stage');
    const contact = section.querySelector('.contact');
    const modeLabel = section.querySelector('.field-mode');
    const zoomOut = section.querySelector('.zoom-out');
    const pick = section.querySelector('.field-pick');
    const blipLayer = stage.querySelector('.blip-layer');
    const ringButtons = [...stage.querySelectorAll('.ring-label')];
    const canvas = stage.querySelector('.field-canvas');
    const ctx = canvas.getContext('2d');
    const base = document.createElement('canvas');
    const baseCtx = base.getContext('2d');
    const coarse = matchMedia('(hover: none)');
    const tpl = document.createElement('template');
    // Blips are created on first use and cached.
    const blips = new Map();
    const bandCache = new Map();

    // Layout of the current render.
    let fieldMode = 'detail';
    let zoomRing = -1;
    let autoZoom = false;
    let ringCounts = [];
    let shown = []; // pieces plotted as blips, in orbit order
    let roving = null; // the one blip in the tab order
    // Contact panel.
    let contactPiece = null;
    let locked = false; // a visitor's selection: the sweep doesn't move the panel
    let unlockTimer = 0;
    let lastSwap = 0;
    let armed = null; // touch: the blip tapped once, which a second tap opens
    // Radar canvas.
    let targets = []; // blips the sweep pings as it passes
    let size = 0;
    let half = 0;
    let cells = [];
    let angle = -Math.PI / 2 + 0.6;
    let lastPaint = 0;
    let inView = false;

    const collectionOf = p => collectionData[p.collection];
    const describe = p =>
      `${esc(p.name)}, ${esc(collectionOf(p).title)}, ${colourOf(p)}, ` +
      `${coord(p).replace('°', ' degrees')}, ${money(p.price)}`;
    const blipHtml = p =>
      `<a class="blip${p.dark ? ' washed' : ''}" href="${linkFor(p)}" data-product="${p.id}" ` +
      `style="${at(ringRadius(p.collection), bearingOf(p))}" aria-label="${describe(p)}"></a>`;
    function blipFor(p) {
      let el = blips.get(p);
      if (!el) {
        tpl.innerHTML = blipHtml(p);
        el = tpl.content.firstElementChild;
        blips.set(p, el);
      }
      return el;
    }

    // ---------- Layout ----------

    const ringCapacity = k => Math.floor((radar.TAU * ringRadius(k) * (half || 300)) / BLIP_SPACING);

    // Zoomed in, pieces are dealt to bands in bearing order by a smooth weighted round-robin, weighted by each
    // band's circumference, so outer bands take more pieces and spacing is even. Stable for a given collection.
    function bandOf(p) {
      let entry = bandCache.get(p.collection);
      if (!entry) {
        const ring = products
          .filter(q => q.collection === p.collection)
          .sort((a, b) => a.bearing - b.bearing);
        const bands = Math.min(6, Math.max(1, Math.ceil(ring.length / 48)));
        const radii = Array.from({ length: bands }, (_, b) =>
          bands === 1 ? 0.62 : 0.3 + (0.5 * b) / (bands - 1),
        );
        const total = radii.reduce((t, r) => t + r, 0);
        const credit = radii.map(() => 0);
        const index = new Map();
        for (const q of ring) {
          radii.forEach((r, b) => {
            credit[b] += r;
          });
          const band = credit.indexOf(Math.max(...credit));
          credit[band] -= total;
          index.set(q, band);
        }
        entry = { bands, radii, index };
        bandCache.set(p.collection, entry);
      }
      return entry;
    }

    function radiusOf(p) {
      if (fieldMode !== 'zoom') return ringRadius(p.collection);
      const { radii, index } = bandOf(p);
      return radii[index.get(p)];
    }

    // A piece's position as percentages of the field: [left, top].
    function pointOf(p) {
      const a = (bearingOf(p) * Math.PI) / 180;
      const r = radiusOf(p);
      return [50 + 50 * r * Math.sin(a), 50 - 50 * r * Math.cos(a)];
    }

    function layoutField() {
      const list = getList();
      ringCounts = collectionData.map(() => 0);
      for (const p of list) ringCounts[p.collection]++;
      let ring = collectionData.findIndex(c => c.id === state.ring);
      // A ring with no pieces at all can't be zoomed into (e.g. an old ?ring= link).
      if (ring >= 0 && !products.some(p => p.collection === ring)) {
        ring = -1;
        state.ring = '';
      }
      const fits = list.length <= DETAIL_MAX && ringCounts.every((n, k) => n <= ringCapacity(k));
      autoZoom = false;
      // Too busy, but only one ring in range (e.g. a collection filter): open that ring directly.
      if (ring < 0 && !fits) {
        const busy = ringCounts.flatMap((n, k) => (n ? [k] : []));
        if (busy.length === 1) {
          ring = busy[0];
          autoZoom = true;
        }
      }
      zoomRing = ring;
      fieldMode = ring >= 0 ? 'zoom' : fits ? 'detail' : 'summary';
    }

    function renderField() {
      layoutField();
      armed = null;
      pick.hidden = true;
      shown =
        fieldMode === 'summary'
          ? []
          : getList()
              .filter(p => fieldMode === 'detail' || p.collection === zoomRing)
              .sort(byOrbit);
      const els = shown.map(p => {
        const el = blipFor(p);
        const [x, y] = pointOf(p);
        el.style.left = x.toFixed(3) + '%';
        el.style.top = y.toFixed(3) + '%';
        el.tabIndex = -1;
        el.classList.remove('active', 'ping');
        return el;
      });
      blipLayer.replaceChildren(...els);
      // One tab stop for the whole radar; arrow keys move between blips.
      roving = blips.get(shown.includes(contactPiece) ? contactPiece : shown[0]) || null;
      if (roving) roving.tabIndex = 0;
      targets = shown.map(p => {
        const a = -Math.PI / 2 + (bearingOf(p) * Math.PI) / 180;
        return { p, el: blips.get(p), a, lag: radar.lag(a, angle) };
      });
      stage.classList.toggle('summary', fieldMode === 'summary');
      stage.classList.toggle('dense', shown.length > DENSE_BLIPS);
      renderRingButtons();
      renderModeLabel();
      zoomOut.hidden = fieldMode !== 'zoom' || autoZoom;
      if (size) repaint();
    }

    // In summary the ring labels become buttons with counts; otherwise they are decoration.
    function renderRingButtons() {
      const summary = fieldMode === 'summary';
      ringButtons.forEach((button, k) => {
        button.hidden = fieldMode === 'zoom';
        button.textContent = pad(k + 1) + (summary ? ' · ' + ringCounts[k] : '');
        button.disabled = summary && !ringCounts[k];
        button.tabIndex = summary ? 0 : -1;
        if (summary) {
          button.removeAttribute('aria-hidden');
          button.setAttribute(
            'aria-label',
            `Zoom into ${esc(collectionData[k].title)}, ${ringCounts[k]} in range`,
          );
        } else {
          button.setAttribute('aria-hidden', 'true');
          button.removeAttribute('aria-label');
        }
      });
    }

    function renderModeLabel() {
      if (fieldMode === 'zoom') {
        modeLabel.innerHTML =
          `<b>Ring ${pad(zoomRing + 1)} · ${esc(collectionData[zoomRing].title)}</b> · ` +
          `${ringCounts[zoomRing]} in range${autoZoom ? ' · only ring in range' : ''}`;
      } else if (fieldMode === 'summary') {
        const total = getList().length.toLocaleString('en-IN');
        modeLabel.innerHTML = `<b>All rings</b> · ${total} in range · too many to plot one by one`;
      } else {
        modeLabel.innerHTML = `<b>All rings</b> · ${shown.length} plotted`;
      }
    }

    // k = ring index, or -1 for all rings. With focus, zooming in lands on the radar's blip and zooming out
    // returns to the ring you came from.
    function zoomTo(k, focus) {
      const from = zoomRing;
      state.ring = k >= 0 ? collectionData[k].id : '';
      apply();
      if (!focus) return;
      const back = ringButtons[from];
      const target = k >= 0 ? roving : back && !back.hidden && !back.disabled ? back : roving;
      target && target.focus({ preventScroll: true });
    }

    section.addEventListener('click', event => {
      const button = event.target.closest('[data-ring]');
      if (button && !button.disabled) zoomTo(Number(button.dataset.ring), true);
    });
    zoomOut.addEventListener('click', () => zoomTo(-1, true));
    // In summary, clicking near a ring zooms into it.
    stage.addEventListener('click', event => {
      if (fieldMode !== 'summary' || event.target.closest('button,a')) return;
      const rect = stage.getBoundingClientRect();
      const distance = Math.hypot(event.clientX - rect.left - half, event.clientY - rect.top - half) / half;
      let nearest = -1;
      let best = 0.09;
      collectionData.forEach((c, i) => {
        const gap = Math.abs(ringRadius(i) - distance);
        if (gap < best && ringCounts[i]) {
          best = gap;
          nearest = i;
        }
      });
      if (nearest >= 0) zoomTo(nearest, false);
    });

    // ---------- Contact panel ----------

    function showOverview() {
      contactPiece = null;
      contact.dataset.mode = 'overview';
      const rings = collectionData
        .map(
          (c, k) =>
            `<li><button data-ring="${esc(k)}"${ringCounts[k] ? '' : ' disabled'}>` +
            `<span>${pad(k + 1)} ${esc(c.title)}</span><span>${ringCounts[k].toLocaleString('en-IN')} ↗</span></button></li>`,
        )
        .join('');
      contact.innerHTML =
        '<div class="contact-head"><span>Contact / <b>Overview</b></span>' +
        `<span>${getList().length.toLocaleString('en-IN')} in range</span></div>` +
        '<div class="contact-body"><h2>Too many signals to plot one by one</h2>' +
        `<p class="contact-note">Zoom into a ring, or narrow the filters.</p><ul class="ring-list">${rings}</ul></div>`;
    }

    // mode: 'selected' (the visitor's choice) or 'tracking' (following the sweep). p = null shows "No signal".
    function showContact(p, mode) {
      if (p === contactPiece && contact.dataset.mode === mode && contact.childElementCount) return;
      contactPiece = p;
      contact.dataset.mode = mode;
      shown.forEach(q => blips.get(q).classList.toggle('active', q === p));
      if (!p) {
        contact.innerHTML =
          '<div class="contact-head"><span>Contact / <b>None</b></span></div>' +
          '<div class="contact-body contact-empty"><h2>No signal</h2><p>Nothing in range for these filters.</p>' +
          '<button class="clear-filters">Clear filters ×</button></div>';
        return;
      }
      contact.innerHTML =
        `<div class="contact-head"><span>Contact / <b>${mode === 'selected' ? 'Selected' : 'Tracking'}</b></span>` +
        `<span>${coord(p)}</span></div>` +
        '<div class="contact-body"><div class="garment-space contact-garment">' +
        `<div class="concept-tee${p.dark ? ' dark' : ''}" data-morph>${art(p, { eager: true, sizes: '200px' })}</div></div>` +
        `<span class="contact-no">No. ${p.id} · ${esc(collectionOf(p).title)}</span><h2>${esc(p.name)}</h2>` +
        `<p class="contact-price">${priceHtml(p)}</p>` +
        `<dl class="contact-readout"><div><dt>Colour</dt><dd>${colourOf(p)}</dd></div>` +
        `<div><dt>Artwork</dt><dd>${esc(p.title)}</dd></div>` +
        `<div><dt>Discipline</dt><dd>${esc(p.discipline)}</dd></div></dl>` +
        `<a class="contact-open" href="${linkFor(p)}"><span>Open piece</span><span aria-hidden="true">↗</span></a></div>`;
      if (!motion.matches) contact.querySelector('.contact-body').classList.add('arriving');
    }

    // After the filters change: keep the panel on something in range.
    function updateContact() {
      if (fieldMode === 'summary') showOverview();
      else if (!contactPiece || !shown.includes(contactPiece)) showContact(shown[0] || null, 'tracking');
    }

    // Hover or focus selects a piece; it releases back to sweep tracking a moment after you leave.
    function select(p) {
      clearTimeout(unlockTimer);
      locked = true;
      showContact(p, 'selected');
    }
    function hold() {
      clearTimeout(unlockTimer);
      locked = true;
    }
    function release() {
      clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => {
        locked = false;
      }, RELEASE_MS);
    }
    const blipPiece = blip => productById(blip.dataset.product);

    stage.addEventListener('pointerover', event => {
      const blip = event.target.closest('.blip');
      if (blip) select(blipPiece(blip));
    });
    stage.addEventListener('pointerout', event => {
      if (event.target.closest('.blip')) release();
    });
    stage.addEventListener('focusin', event => {
      const blip = event.target.closest('.blip');
      if (!blip) return;
      if (roving && roving !== blip) roving.tabIndex = -1;
      roving = blip;
      blip.tabIndex = 0;
      select(blipPiece(blip));
    });
    stage.addEventListener('focusout', release);
    contact.addEventListener('pointerenter', hold);
    contact.addEventListener('pointerleave', release);
    contact.addEventListener('focusin', hold);
    contact.addEventListener('focusout', release);

    // Arrow keys, Home and End step between blips in orbit order; Escape zooms out.
    stage.addEventListener('keydown', event => {
      if (event.key === 'Escape' && fieldMode === 'zoom' && !autoZoom) {
        event.preventDefault();
        zoomTo(-1, true);
        return;
      }
      const blip = event.target.closest('.blip');
      if (!blip || !shown.length) return;
      const i = shown.indexOf(blipPiece(blip));
      const next = {
        ArrowRight: i + 1,
        ArrowDown: i + 1,
        ArrowLeft: i - 1,
        ArrowUp: i - 1,
        Home: 0,
        End: shown.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      blips.get(shown[(next + shown.length) % shown.length]).focus();
    });

    // Touch screens: blips are close together, so the first tap selects (named just above the radar) and a
    // second tap on the same blip, or "Open", opens it.
    stage.addEventListener('click', event => {
      const blip = event.target.closest('.blip');
      if (!blip || !coarse.matches) return;
      const p = blipPiece(blip);
      if (armed === p) return;
      event.preventDefault();
      armed = p;
      select(p);
      pick.hidden = false;
      pick.innerHTML = `Selected · <b>${esc(p.name)}</b> · ${coord(p)} <a href="${linkFor(p)}">Open ↗</a>`;
    });

    // Opening the contact (or its blip) morphs the panel's garment into the product stage.
    section.addEventListener('click', event => {
      const target = event.target.closest('.contact-open,.blip');
      const tee = contact.querySelector('[data-morph]');
      if (target && tee && contactPiece && target.getAttribute('href') === linkFor(contactPiece)) {
        tee.style.viewTransitionName = 'piece';
      }
    });

    // ---------- Radar canvas ----------

    function resizeField() {
      const width = stage.clientWidth;
      if (!width || section.hidden) return;
      const small = width < 520;
      const cellW = small ? 6 : 7;
      const cellH = small ? 9 : 10;
      const firstSize = !size;
      size = width;
      half = width / 2;
      radar.size([canvas, base], size, size);
      const limit = half * 0.97;
      cells = [];
      for (let col = -Math.floor(limit / cellW); col <= Math.floor(limit / cellW); col++) {
        for (let row = -Math.floor(limit / cellH); row <= Math.floor(limit / cellH); row++) {
          const x = col * cellW;
          const y = row * cellH;
          if (Math.hypot(x, y) > limit) continue;
          cells.push({
            x: half + x,
            y: half + y,
            theta: Math.atan2(y, x),
            glyph: radar.gridGlyph(col, row),
            axis: col === 0 || row === 0,
            echo: 0,
          });
        }
      }
      // Ring capacity depends on the radar's size, so the first real size can change the mode.
      if (firstSize && state.view === 'field') renderField();
      repaint();
    }

    const dottedRing = (fraction, tone) => {
      baseCtx.fillStyle = tones[tone];
      radar.ringDots(baseCtx, half, half, fraction * half, 6, 16);
    };

    // The static layer: grid, rings, unlinked pieces and the bearing scale.
    function paintBase() {
      baseCtx.clearRect(0, 0, size, size);
      for (const cell of cells) {
        if (!cell.glyph) continue;
        baseCtx.fillStyle = tones[cell.axis ? 34 : 17];
        baseCtx.fillText(cell.glyph, cell.x, cell.y);
      }
      if (fieldMode === 'zoom') {
        const { radii } = bandOf(products.find(p => p.collection === zoomRing));
        for (const r of radii) dottedRing(r, 40);
      } else {
        collectionData.forEach((c, k) =>
          dottedRing(ringRadius(k), fieldMode === 'summary' && !ringCounts[k] ? 22 : 46),
        );
      }
      dottedRing(0.97, 26);
      // Pieces without a blip: filtered-out ones as faint dots; in summary, everything in range as a density band.
      const plotted = new Set(shown);
      const pool = fieldMode === 'zoom' ? products.filter(p => p.collection === zoomRing) : products;
      for (const p of pool) {
        if (plotted.has(p)) continue;
        const inRange = isVisible(p);
        if (fieldMode !== 'summary' && inRange) continue;
        baseCtx.fillStyle = tones[inRange ? 66 : 18];
        const [x, y] = pointOf(p);
        baseCtx.fillText(inRange ? ':' : '.', (x / 100) * size, (y / 100) * size);
      }
      // Bearing scale: a mark every 10°, crosses every 30°, labels at the cardinals.
      const scalePoint = (degrees, fraction) => {
        const a = -Math.PI / 2 + (degrees * Math.PI) / 180;
        return [half + Math.cos(a) * half * fraction, half + Math.sin(a) * half * fraction];
      };
      for (let d = 0; d < 360; d += 10) {
        baseCtx.fillStyle = tones[d % 90 ? 32 : 64];
        baseCtx.fillText(d % 30 ? '.' : '+', ...scalePoint(d, 0.88));
      }
      baseCtx.font = '9px monospace';
      baseCtx.fillStyle = tones[72];
      for (const d of [0, 90, 180, 270]) baseCtx.fillText(pad(d, 3), ...scalePoint(d, 0.93));
      baseCtx.font = '11px monospace';
    }

    function paintField(now) {
      if (!size || (!motion.matches && now - lastPaint < radar.FRAME_MS)) return;
      const dt = Math.min((now - lastPaint) / 1000, 0.05);
      const paintStart = performance.now();
      lastPaint = now;
      radar.drawBase(ctx, base, size, size);
      if (motion.matches) return;
      // Counterclockwise, like the homepage radar. A blip pings as the leading edge crosses its bearing.
      angle = (angle - SWEEP_SPEED * dt) % radar.TAU;
      const decay = Math.exp(-dt / 0.9);
      for (const cell of cells) {
        const lag = radar.lag(cell.theta, angle);
        const strength = lag < SWEEP_WIDTH ? Math.pow(1 - lag / SWEEP_WIDTH, 1.6) : 0;
        cell.echo = Math.max(cell.echo * decay, strength > 0 ? 0.04 + strength * 0.1 : 0);
        const brightness = Math.max(strength, cell.echo);
        if (brightness < 0.012) continue;
        ctx.fillStyle = tones[Math.round(12 + brightness * 70)];
        ctx.fillText(cell.glyph || radar.sweepGlyph(brightness), cell.x, cell.y);
      }
      for (const target of targets) {
        const lag = radar.lag(target.a, angle);
        if (lag < target.lag) ping(target, now);
        target.lag = lag;
      }
      radarPerf?.record('field paint', performance.now() - paintStart);
    }

    function repaint() {
      paintBase();
      lastPaint = 0;
      paintField(performance.now());
    }

    function ping(target, now) {
      target.el.classList.remove('ping');
      void target.el.offsetWidth; // restart the CSS animation
      target.el.classList.add('ping');
      // Without a selection, the contact panel tracks what the sweep finds, at a readable pace.
      if (!locked && now - lastSwap > TRACK_INTERVAL_MS) {
        showContact(target.p, 'tracking');
        lastSwap = now;
      }
    }
    stage.addEventListener('animationend', event => {
      if (event.target.classList.contains('blip')) event.target.classList.remove('ping');
    });

    const animation = radar.loop(
      paintField,
      () => state.view === 'field' && inView && !document.hidden && !motion.matches,
    );
    function syncField() {
      if (state.view !== 'field') return animation.stop();
      if (!size) resizeField();
      if (!animation.sync()) {
        lastPaint = 0;
        paintField(performance.now());
      }
    }
    new ResizeObserver(resizeField).observe(stage);
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncField();
    }).observe(stage);
    document.addEventListener('visibilitychange', syncField);
    motion.addEventListener('change', syncField);
    document.addEventListener('radar:theme', () => {
      if (size) repaint();
    });

    return {
      render: renderField,
      updateContact,
      sync: syncField,
      includes: p => shown.includes(p),
      blipFor: p => blips.get(p),
      select,
    };
  }

  return { markup, mount };
})();
