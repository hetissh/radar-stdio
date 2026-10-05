// Homepage collections: one full-height section per collection, each with a horizontal rail of product cards
// riding a curved orbit. Scrolling the page scans the rail sideways (unless the visitor has taken over with drag,
// wheel or keys); the card nearest the centre is "in focus". Behind each rail a canvas draws the orbit's three
// dotted arcs and a field of dots that a sweep lights as it crosses, fading under the cards.
//
// Classic script (see shared.js): defines the global `homeCollections`. Uses shared.js and radar.js.
// home.js inserts homeCollections.markup() into the page, then calls homeCollections.mount().
const homeCollections = (() => {
  const RAIL_LIMIT = 12; // featured pieces per rail; keep in step with RAIL_LIMIT in scripts/build_data.py
  const ECHO_MS = 1800; // how long a "+" lingers where the focused card used to be
  const DRAG_THRESHOLD = 6; // px a mouse must move before a press becomes a drag

  // ---------- Markup ----------

  // A rail shows up to RAIL_LIMIT featured pieces in curated order; a larger collection ends with a "View all"
  // card that opens the catalogue filtered to it. home.json carries only the featured pieces, so the
  // collection's full size comes from its count.
  function railCards(i) {
    const c = collectionData[i];
    const total = c.count;
    const shown = products
      .filter(p => p.collection === i)
      .sort((x, y) => x.position - y.position)
      .slice(0, RAIL_LIMIT);
    if (!total) return '<p class="rail-empty mono">No pieces on this orbit yet</p>';
    const more =
      total > shown.length
        ? `<a class="product-card rail-more" href="catalogue.html?collection=${esc(c.id)}" ` +
          `aria-label="View all ${total} ${esc(c.title)} in the catalogue">` +
          `<div class="garment-space"><span class="signal-tag">ALL / ${total}</span>` +
          `<div class="rail-more-mark" aria-hidden="true">+${total - shown.length}</div></div>` +
          `<div class="piece-caption"><span>View all ${esc(c.title)}</span><span class="mono">↗</span></div>` +
          `<div class="piece-meta">${total} pieces in the catalogue</div></a>`
        : '';
    return shown.map(productCard).join('') + more;
  }

  function markup() {
    return collectionData
      .map(
        (c, i) =>
          `<section class="collection" id="${esc(c.id)}" aria-labelledby="collection-title-${i}"><div class="collection-inner">` +
          `<div class="collection-heading"><div><span class="mono muted">${pad(i + 1)} / COLLECTIONS</span>` +
          `<h2 id="collection-title-${i}">${esc(c.title)}</h2></div>` +
          `<p class="collection-description">${escLines(c.copy)}</p></div>` +
          '<div class="arc-stage"><canvas class="arc-field" aria-hidden="true"></canvas>' +
          `<div class="clothing-rail" tabindex="0" role="region" aria-label="${esc(c.title)} clothing cards">${railCards(i)}</div></div>` +
          `<div class="collection-bottom"><span class="field-counter">01 / ${pad(Math.min(c.count, RAIL_LIMIT))}` +
          '<span class="field-progress"></span></span><span class="mono">Scroll to scan · Select a piece</span></div>' +
          '</div></section>',
      )
      .join('');
  }

  // Wire up the sections markup() produced.
  //   sections  the collection <section> elements, by collection index
  //   motion    the prefers-reduced-motion media query (no auto-scan, no animation)
  //   onSync(active)  called after every scroll sync with the collection index in view, or -1
  function mount({ sections, motion, onSync }) {
    // One model per collection: its elements, canvas geometry and the field's points.
    const fields = sections.map((section, i) => {
      const canvas = section.querySelector('canvas');
      return {
        section,
        index: i,
        rail: section.querySelector('.clothing-rail'),
        cards: [...section.querySelectorAll('.product-card')],
        canvas,
        context: canvas.getContext('2d'),
        points: [], // the dot field
        ringPoints: [], // the three orbit arcs
        echoes: [],
        width: 0,
        height: 0,
        manual: false, // the visitor has scrolled this rail themselves
        focused: 0,
      };
    });
    let fieldFrame = 0;
    let activeField = -1;
    let lastFieldTime = 0;
    let lastPageY = scrollY;

    // ---------- Geometry ----------

    function resizeField(model) {
      const rect = model.canvas.getBoundingClientRect();
      const { width, height } = rect;
      model.width = width;
      model.height = height;
      radar.size([model.canvas], width, height, '10px monospace');
      model.points = [];
      model.ringPoints = [];
      // The orbit is a circle far below the stage; its top edge forms the arc the cards ride.
      const radius = Math.max(width * 0.9, width / 2 + 120, 500);
      const baseline = height * 0.43;
      const centerY = baseline + radius;
      model.centerY = centerY;
      model.radius = radius;
      model.arcBaseline = baseline;
      model.canvas.dataset.orbitRadius = radius;
      model.canvas.dataset.orbitCenterX = width / 2;
      model.canvas.dataset.orbitCenterY = centerY;
      for (let y = 6; y < height; y += 16) {
        for (let x = 7; x < width; x += 14) {
          model.points.push({ x, y, theta: Math.atan2(y - centerY, x - width / 2), echo: 0 });
        }
      }
      const spacing = clamp(height * 0.16, 65, 110);
      for (const r of [radius, radius + spacing, radius - spacing]) {
        // Equal arc-length intervals keep all three radar layers uniform.
        const extent = Math.asin(Math.min(1, width / 2 / r));
        for (let angle = -extent; angle <= extent; angle += 7 / r) {
          const x = width / 2 + r * Math.sin(angle);
          const y = centerY - r * Math.cos(angle);
          if (y > 0 && y < height) model.ringPoints.push({ x, y, primary: r === radius });
        }
      }
      layoutCards(model);
      scheduleField();
    }

    // The arc's height at a horizontal offset from the rail's centre.
    function orbitY(model, offset) {
      const radius = model.radius || Math.max(model.rail.clientWidth * 0.9, 500);
      const limit = Math.min(radius * 0.98, model.rail.clientWidth / 2 + 32);
      const x = clamp(offset, -limit, limit);
      return (
        (model.arcBaseline ?? model.rail.clientHeight * 0.43) + radius - Math.sqrt(radius * radius - x * x)
      );
    }

    // How visible a field point is: 0 under a card's caption, fading towards 1 away from its garment.
    function fieldQuietness(point, zones) {
      let quietness = 1;
      for (const zone of zones) {
        if (point.x >= zone.left && point.x <= zone.right && point.y >= zone.top && point.y <= zone.bottom)
          return 0;
        quietness = Math.min(
          quietness,
          radar.fade(Math.hypot((point.x - zone.x) / zone.rx, (point.y - zone.y) / zone.ry)),
        );
      }
      return quietness;
    }

    // ---------- Cards on the orbit ----------

    // Place each card on the arc (raised, scaled and dimmed by its distance from the centre), track the card in
    // focus, and cache where the cards are so the canvas can fade under them.
    function layoutCards(model) {
      const layoutStart = performance.now();
      const counter = model.section.querySelector('.field-counter');
      // An empty collection has nothing to lay out.
      if (!model.cards.length) {
        model.foregroundZones = [];
        counter.firstChild.textContent = '00 / 00';
        return;
      }
      const rail = model.rail;
      const center = rail.scrollLeft + rail.clientWidth / 2;
      // Focus/locator scrolling must not displace the rail vertically off its orbit.
      if (rail.scrollTop) rail.scrollTop = 0;
      let closest = 0;
      let distance = Infinity;
      model.cards.forEach((card, i) => {
        const offset = card.offsetLeft + card.offsetWidth / 2 - center;
        if (Math.abs(offset) < distance) {
          distance = Math.abs(offset);
          closest = i;
        }
        const normalized = offset / Math.max(300, rail.clientWidth * 0.5);
        const scale = motion.matches ? 1 : 1.025 - Math.min(0.095, Math.abs(normalized) * 0.05);
        const garment = card.querySelector('.garment-space');
        const garmentOffset = garment.offsetTop + garment.offsetHeight / 2 - card.offsetHeight / 2;
        const y = orbitY(model, offset);
        // Anchor the garment's centre, rather than the card (which includes its caption).
        card.style.setProperty('--rise', y - rail.clientHeight / 2 - scale * garmentOffset + 'px');
        card.style.setProperty('--scale', String(scale));
        card.style.setProperty('--visibility', String(1 - Math.min(0.2, Math.abs(normalized) * 0.12)));
        card.style.setProperty('--focus-light', String(1 - Math.min(0.3, Math.abs(normalized) * 0.2)));
      });
      if (closest !== model.focused) model.echoes.push({ index: model.focused, born: performance.now() });
      model.focused = closest;
      model.cards.forEach((card, i) => {
        if (card.classList.contains('rail-more')) return;
        card.querySelector('.signal-tag').textContent =
          pad(i + 1) + (i === closest ? ' / IN FOCUS' : ' / SIGNAL');
      });
      // Cache soft foreground masks when the rail moves, rather than reading layout every frame.
      const stage = model.canvas.getBoundingClientRect();
      const zones = [];
      model.cards.forEach(card => {
        const garment = card.querySelector('.garment-space').getBoundingClientRect();
        if (garment.right < stage.left || garment.left > stage.right) return;
        const caption = card.querySelector('.piece-caption').getBoundingClientRect();
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
      });
      model.foregroundZones = zones;
      model.points.forEach(point => (point.quietness = fieldQuietness(point, zones)));
      model.ringPoints.forEach(point => (point.quietness = fieldQuietness(point, zones)));
      // The counter counts pieces; a closing "View all" card is not one.
      const pieceCount =
        model.cards.length - (model.cards[model.cards.length - 1].classList.contains('rail-more') ? 1 : 0);
      counter.firstChild.textContent = pad(Math.min(closest + 1, pieceCount)) + ' / ' + pad(pieceCount);
      counter.style.setProperty('--progress', (closest + 1) / model.cards.length);
      radarPerf?.record('rail layout', performance.now() - layoutStart);
    }

    // On scroll: find the collection in view, scan each rail to match page progress, and re-lay visible rails.
    function syncCollections() {
      const pageMoved = Math.abs(scrollY - lastPageY) > 1;
      lastPageY = scrollY;
      let current = -1;
      fields.forEach(model => {
        const rect = model.section.getBoundingClientRect();
        if (rect.top < innerHeight * 0.6 && rect.bottom > innerHeight * 0.5) current = model.index;
        // Scrolling the page hands the rail back to the automatic scan.
        if (pageMoved) model.manual = false;
        if (!model.manual && !motion.matches) {
          const progress = clamp(-rect.top / Math.max(1, rect.height - innerHeight), 0, 1);
          const goal = progress * (model.rail.scrollWidth - model.rail.clientWidth);
          if (Math.abs(model.rail.scrollLeft - goal) > 1) model.rail.scrollLeft = goal;
        }
        if (rect.top < innerHeight && rect.bottom > 0) layoutCards(model);
      });
      activeField = current;
      onSync(current);
      scheduleField();
    }

    // ---------- Field canvas ----------

    function drawField(model, now, dt) {
      const ctx = model.context;
      const w = model.width;
      const h = model.height;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      // The scan line travels left to right along the arc, wrapping around off-screen.
      const scanX = ((now * 0.045) % (w + 280)) - 140;
      const theta = Math.atan2(model.arcBaseline - model.centerY, scanX - w / 2);
      const decay = Math.exp(-dt / 0.75);
      for (const point of model.points) {
        const lag = theta - point.theta;
        const strength = lag > 0 && lag < 0.27 ? Math.pow(1 - lag / 0.27, 1.8) : 0;
        point.echo = Math.max(point.echo * decay, strength * 0.13);
        const light = Math.max(strength, point.echo);
        if (light < 0.008) continue;
        const shade = Math.round((5 + light * 22) * (point.quietness ?? 1));
        if (shade < 3) continue;
        ctx.fillStyle = tones[shade];
        ctx.fillText(light > 0.5 ? ':' : '.', point.x, point.y);
      }
      for (const point of model.ringPoints) {
        const brightness = clamp(1 - Math.abs(point.x - scanX) / 220, 0, 1);
        const shade = Math.round(((point.primary ? 55 : 24) + brightness * 29) * (point.quietness ?? 1));
        if (shade < 3) continue;
        ctx.fillStyle = tones[shade];
        ctx.fillText('.', point.x, point.y);
      }
      model.echoes = model.echoes.filter(e => now - e.born < ECHO_MS);
      for (const echo of model.echoes) {
        const card = model.cards[echo.index];
        const x = card.offsetLeft + card.offsetWidth / 2 - model.rail.scrollLeft;
        const y = orbitY(model, x - w / 2);
        const quietness = fieldQuietness({ x, y }, model.foregroundZones || []);
        ctx.fillStyle = `rgba(${echoInk},${(1 - (now - echo.born) / ECHO_MS) * 0.22 * quietness})`;
        ctx.fillText('+', x, y);
      }
    }

    // Only the collection in view animates. With reduced motion it draws one frame per change.
    function fieldTick(now) {
      fieldFrame = 0;
      if (document.hidden || activeField < 0) return;
      const dt = Math.min((now - lastFieldTime) / 1000, 0.06);
      lastFieldTime = now;
      drawField(fields[activeField], now, dt);
      if (!motion.matches) fieldFrame = requestAnimationFrame(fieldTick);
    }
    function scheduleField() {
      if (fieldFrame || document.hidden || activeField < 0) return;
      lastFieldTime = performance.now();
      fieldFrame = requestAnimationFrame(fieldTick);
    }
    function restartField() {
      if (fieldFrame) cancelAnimationFrame(fieldFrame);
      fieldFrame = 0;
    }

    // ---------- Rail interaction: wheel, drag and keys ----------

    fields.forEach(model => {
      const rail = model.rail;
      new ResizeObserver(() => resizeField(model)).observe(model.section.querySelector('.arc-stage'));
      rail.addEventListener('scroll', () => layoutCards(model), { passive: true });
      rail.addEventListener(
        'wheel',
        event => {
          if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) model.manual = true;
        },
        { passive: true },
      );
      // Mouse drag scrolls the rail; a drag must not also open the card it started on.
      let drag = null;
      let suppressClick = false;
      rail.addEventListener(
        'pointerdown',
        event => {
          model.manual = true;
          if (event.pointerType === 'mouse') {
            drag = { id: event.pointerId, x: event.clientX, left: rail.scrollLeft, moved: false };
            suppressClick = false;
          }
        },
        { passive: true },
      );
      rail.addEventListener('pointermove', event => {
        if (!drag) return;
        const dx = event.clientX - drag.x;
        if (Math.abs(dx) > DRAG_THRESHOLD) {
          drag.moved = true;
          rail.setPointerCapture(drag.id);
        }
        if (drag.moved) {
          event.preventDefault();
          rail.scrollLeft = drag.left - dx;
          suppressClick = true;
        }
      });
      const release = () => {
        if (drag && rail.hasPointerCapture(drag.id)) rail.releasePointerCapture(drag.id);
        drag = null;
      };
      rail.addEventListener('pointerup', release);
      rail.addEventListener('pointercancel', release);
      rail.addEventListener(
        'click',
        event => {
          if (!suppressClick) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClick = false;
        },
        true,
      );
      // Arrow keys step one card at a time.
      rail.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        if (model.cards.length < 2) return;
        event.preventDefault();
        model.manual = true;
        const step = model.cards[1].offsetLeft - model.cards[0].offsetLeft;
        rail.scrollBy({
          left: (event.key === 'ArrowRight' ? 1 : -1) * step,
          behavior: motion.matches ? 'instant' : 'smooth',
        });
      });
    });

    addEventListener('scroll', syncCollections, { passive: true });
    addEventListener('resize', syncCollections);
    document.addEventListener('visibilitychange', () => {
      restartField();
      scheduleField();
    });
    // Redraw every field, so inactive canvases do not keep marks in the previous theme.
    document.addEventListener('radar:theme', () => {
      const now = performance.now();
      fields.forEach(model => drawField(model, now, 0));
      scheduleField();
    });
    motion.addEventListener('change', () => {
      restartField();
      fields.forEach(model => layoutCards(model));
      syncCollections();
    });
    syncCollections();
    returnToPiece();

    // Returning from a product page (?piece=ID) lands with that piece in focus on its orbit.
    // The homepage only loads featured pieces; a piece beyond them lands on its rail's "View all" card.
    function returnToPiece() {
      const params = new URLSearchParams(location.search);
      const piece = productById(params.get('piece') || '');
      const ring = piece
        ? piece.collection
        : collectionData.findIndex(c => c.id === params.get('collection'));
      if (!params.has('piece') || ring < 0) return;
      requestAnimationFrame(() => {
        // Find the card by id (positions may have gaps); a piece not on the rail lands on its last card.
        const model = fields[ring];
        const card =
          (piece && model.cards.find(c => c.dataset.product === piece.id)) ||
          model.cards[model.cards.length - 1];
        if (!card) return;
        const rail = model.rail;
        const span = Math.max(1, rail.scrollWidth - rail.clientWidth);
        const goal = clamp(card.offsetLeft + card.offsetWidth / 2 - rail.clientWidth / 2, 0, span);
        const top = model.section.getBoundingClientRect().top + scrollY;
        if (motion.matches) {
          scrollTo({ top, behavior: 'instant' });
          model.manual = true;
          rail.scrollLeft = goal;
        } else {
          // The page's scroll position drives the rail's scan, so scroll the page to where the scan shows the card.
          scrollTo({
            top: top + (goal / span) * (model.section.offsetHeight - innerHeight),
            behavior: 'instant',
          });
        }
        history.replaceState(null, '', location.pathname + '#' + collectionData[ring].id);
        syncCollections();
      });
    }
  }

  return { markup, mount };
})();
