/**
 * @fileoverview The canvas behind each homepage collection rail: three dotted
 * orbit arcs (the cards ride the middle one) and a field of dots that a sweep
 * lights as it crosses. Marks fade under the cards, and a "+" lingers briefly
 * where the focused card used to be. Only the collection in view animates.
 *
 * home-collections.js owns the rails and calls into the controller returned
 * by homeArcs.mount().
 */

/* exported homeArcs */
/* global clamp, radar, tones, echoInk */

const homeArcs = (() => {
  // How long a focus echo ("+") lingers, in milliseconds.
  const ECHO_MS = 1800;
  // Horizontal spacing of the dot field, and of dots along each arc, in px.
  const FIELD_STEP_X = 14;
  const FIELD_STEP_Y = 16;
  const ARC_DOT_SPACING = 7;
  // How far behind the scan line the sweep's glow reaches, in radians.
  const SWEEP_WIDTH = 0.27;

  /**
   * Starts the arc canvases.
   * @param {{rails: !Array<!HomeRail>, motion: !MediaQueryList}} options
   *     motion is the prefers-reduced-motion query: one frame per change.
   * @return {{
   *   resize: function(!HomeRail),
   *   orbitY: function(!HomeRail, number): number,
   *   setForeground: function(!HomeRail, !Array<!Object>),
   *   addEcho: function(!HomeRail, number),
   *   setActive: function(number),
   *   schedule: function(),
   *   stop: function(),
   * }}
   */
  function mount({ rails, motion }) {
    let frame = 0;
    let activeIndex = -1;
    let lastTime = 0;

    /**
     * Sizes a rail's canvas and lays out its arcs and dot field. The orbit is
     * a circle far below the stage; its top edge forms the arc the cards
     * ride.
     * @param {!HomeRail} rail
     */
    function resize(rail) {
      const { width, height } = rail.canvas.getBoundingClientRect();
      rail.width = width;
      rail.height = height;
      radar.size([rail.canvas], { width, height, font: '10px monospace' });
      const radius = Math.max(width * 0.9, width / 2 + 120, 500);
      const baseline = height * 0.43;
      const centerY = baseline + radius;
      rail.centerY = centerY;
      rail.radius = radius;
      rail.arcBaseline = baseline;
      rail.canvas.dataset.orbitRadius = radius;
      rail.canvas.dataset.orbitCenterX = width / 2;
      rail.canvas.dataset.orbitCenterY = centerY;
      rail.points = [];
      for (let y = 6; y < height; y += FIELD_STEP_Y) {
        for (let x = 7; x < width; x += FIELD_STEP_X) {
          const theta = Math.atan2(y - centerY, x - width / 2);
          rail.points.push({ x, y, theta, echo: 0 });
        }
      }
      rail.ringPoints = [];
      const spacing = clamp(height * 0.16, 65, 110);
      for (const arcRadius of [radius, radius + spacing, radius - spacing]) {
        // Equal arc-length intervals keep all three arcs uniform.
        const extent = Math.asin(Math.min(1, width / 2 / arcRadius));
        const step = ARC_DOT_SPACING / arcRadius;
        for (let angle = -extent; angle <= extent; angle += step) {
          const x = width / 2 + arcRadius * Math.sin(angle);
          const y = centerY - arcRadius * Math.cos(angle);
          if (y > 0 && y < height) {
            rail.ringPoints.push({ x, y, primary: arcRadius === radius });
          }
        }
      }
    }

    /**
     * The arc's height at a horizontal offset from the rail's centre.
     * @param {!HomeRail} rail
     * @param {number} offset Pixels; negative is left of centre.
     * @return {number} Pixels from the top of the stage.
     */
    function orbitY(rail, offset) {
      const radius =
        rail.radius || Math.max(rail.element.clientWidth * 0.9, 500);
      const limit = Math.min(radius * 0.98, rail.element.clientWidth / 2 + 32);
      const x = clamp(offset, -limit, limit);
      const baseline = rail.arcBaseline ?? rail.element.clientHeight * 0.43;
      return baseline + radius - Math.sqrt(radius * radius - x * x);
    }

    /**
     * How visible a mark is: 0 under a card's caption, fading towards 1 away
     * from its garment.
     * @param {{x: number, y: number}} point
     * @param {!Array<!Object>} zones From setForeground().
     * @return {number}
     */
    function quietness(point, zones) {
      let result = 1;
      for (const zone of zones) {
        const underCaption =
          point.x >= zone.left &&
          point.x <= zone.right &&
          point.y >= zone.top &&
          point.y <= zone.bottom;
        if (underCaption) return 0;
        const distance = Math.hypot(
          (point.x - zone.x) / zone.rx,
          (point.y - zone.y) / zone.ry,
        );
        result = Math.min(result, radar.fade(distance));
      }
      return result;
    }

    /**
     * Records where the cards are, so marks fade under them. Called when the
     * rail moves, rather than reading layout every frame.
     * @param {!HomeRail} rail
     * @param {!Array<!Object>} zones One per visible card: its garment's
     *     centre (x, y) and radii (rx, ry), and its caption's box (left,
     *     right, top, bottom), in canvas pixels.
     */
    function setForeground(rail, zones) {
      rail.foregroundZones = zones;
      for (const point of [...rail.points, ...rail.ringPoints]) {
        point.quietness = quietness(point, zones);
      }
    }

    /**
     * Leaves a fading "+" where a card was in focus.
     * @param {!HomeRail} rail
     * @param {number} cardIndex
     */
    function addEcho(rail, cardIndex) {
      rail.echoes.push({ index: cardIndex, born: performance.now() });
    }

    /**
     * Draws one frame of a rail's canvas.
     * @param {!HomeRail} rail
     * @param {{now: number, dt: number}} time dt is seconds since the last
     *     frame (0 for a still redraw).
     */
    function draw(rail, { now, dt }) {
      const ctx = rail.context;
      const { width, height } = rail;
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);
      // The scan line travels left to right along the arc, wrapping around
      // off-screen.
      const scanX = ((now * 0.045) % (width + 280)) - 140;
      const theta = Math.atan2(
        rail.arcBaseline - rail.centerY,
        scanX - width / 2,
      );
      const decay = Math.exp(-dt / 0.75);
      for (const point of rail.points) {
        const lag = theta - point.theta;
        const strength =
          lag > 0 && lag < SWEEP_WIDTH
            ? Math.pow(1 - lag / SWEEP_WIDTH, 1.8)
            : 0;
        point.echo = Math.max(point.echo * decay, strength * 0.13);
        const light = Math.max(strength, point.echo);
        if (light < 0.008) continue;
        const shade = Math.round((5 + light * 22) * (point.quietness ?? 1));
        if (shade < 3) continue;
        ctx.fillStyle = tones[shade];
        ctx.fillText(light > 0.5 ? ':' : '.', point.x, point.y);
      }
      for (const point of rail.ringPoints) {
        const brightness = clamp(1 - Math.abs(point.x - scanX) / 220, 0, 1);
        const base = point.primary ? 55 : 24;
        const shade = Math.round(
          (base + brightness * 29) * (point.quietness ?? 1),
        );
        if (shade < 3) continue;
        ctx.fillStyle = tones[shade];
        ctx.fillText('.', point.x, point.y);
      }
      rail.echoes = rail.echoes.filter(echo => now - echo.born < ECHO_MS);
      for (const echo of rail.echoes) {
        const card = rail.cards[echo.index];
        const x =
          card.offsetLeft + card.offsetWidth / 2 - rail.element.scrollLeft;
        const y = orbitY(rail, x - width / 2);
        const fadeOut = 1 - (now - echo.born) / ECHO_MS;
        const alpha =
          fadeOut * 0.22 * quietness({ x, y }, rail.foregroundZones || []);
        ctx.fillStyle = `rgba(${echoInk},${alpha})`;
        ctx.fillText('+', x, y);
      }
    }

    /**
     * Draws the active rail; keeps going unless motion is reduced.
     * @param {number} now
     */
    function tick(now) {
      frame = 0;
      if (document.hidden || activeIndex < 0) return;
      const dt = Math.min((now - lastTime) / 1000, 0.06);
      lastTime = now;
      draw(rails[activeIndex], { now, dt });
      if (!motion.matches) frame = requestAnimationFrame(tick);
    }

    /**
     * Sets which rail is in view (-1 for none).
     * @param {number} index
     */
    function setActive(index) {
      activeIndex = index;
    }

    /** Starts drawing the active rail, unless already drawing. */
    function schedule() {
      if (frame || document.hidden || activeIndex < 0) return;
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    }

    /** Cancels the next frame. */
    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    document.addEventListener('visibilitychange', () => {
      stop();
      schedule();
    });
    // Redraw every rail, so inactive canvases don't keep marks in the
    // previous theme.
    document.addEventListener('radar:theme', () => {
      const now = performance.now();
      rails.forEach(rail => draw(rail, { now, dt: 0 }));
      schedule();
    });

    return {
      resize,
      orbitY,
      setForeground,
      addEcho,
      setActive,
      schedule,
      stop,
    };
  }

  return { mount };
})();
