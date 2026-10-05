/**
 * @fileoverview The catalogue field's canvas: a circular ASCII radar with the
 * collection rings (or, zoomed in, one ring's bands), a bearing scale, and
 * faint dots for pieces without a blip. The sweep turns counterclockwise, like
 * the homepage radar, and pings each blip as its leading edge passes.
 *
 * catalogue-field.js owns the layout and calls into the controller returned
 * by catalogueRadar.mount().
 */

/* exported catalogueRadar */
/* global pad, targetElement, element, radar, tones, products */
/* global collectionData, radarPerf */

/**
 * One glyph cell of the field's grid.
 * @typedef {object} FieldCell
 * @property {number} x
 * @property {number} y
 * @property {number} theta Angle from the centre, in radians.
 * @property {string} glyph The static grid mark, or ''.
 * @property {boolean} axis On the centre row or column.
 * @property {number} echo Afterglow, 0 to 1.
 */

/**
 * A plotted piece and its blip.
 * @typedef {{piece: !Piece, element: !HTMLElement}} FieldBlip
 */

/**
 * A blip the sweep pings, at its bearing.
 * @typedef {object} PingTarget
 * @property {!Piece} piece
 * @property {!HTMLElement} element
 * @property {number} angle The bearing, in canvas radians.
 * @property {number} lag How far it trailed the sweep last frame.
 */

const catalogueRadar = (() => {
  // Radians of afterglow behind the sweep line.
  const SWEEP_WIDTH = 1.4;
  // Radians per second.
  const SWEEP_SPEED = (18 * Math.PI) / 180;
  // The radar's edge, as a fraction of its half-width.
  const RIM = 0.97;

  /**
   * Starts the canvas.
   * @param {{
   *   stage: !HTMLElement,
   *   motion: !MediaQueryList,
   *   layout: !FieldLayout,
   *   isActive: function(): boolean,
   *   isHidden: function(): boolean,
   *   onFirstSize: function(): void,
   *   onPing: function(!Piece, number): void,
   * }} options stage holds the .field-canvas; motion is the
   *     prefers-reduced-motion query (a still radar); layout is read on
   *     every paint; isActive says whether the field view is chosen, and
   *     isHidden whether its section is hidden; onFirstSize runs once the
   *     radar first has a size (ring capacity depends on it); onPing(piece,
   *     now) runs when the sweep pings a blip.
   * @return {{
   *   repaint: function(): void,
   *   sync: function(): void,
   *   setTargets: function(!Array<!FieldBlip>): void,
   *   halfWidth: function(): number,
   * }}
   */
  function mount(options) {
    const { stage, motion, layout, isActive, isHidden } = options;
    const { onFirstSize, onPing } = options;
    const canvas = /** @type {!HTMLCanvasElement} */ (
      element(stage, '.field-canvas')
    );
    const ctx = radar.context2d(canvas);
    const base = document.createElement('canvas');
    const baseCtx = radar.context2d(base);
    let size = 0;
    let half = 0;
    /** @type {!Array<!FieldCell>} */
    let cells = [];
    /** @type {!Array<!PingTarget>} */
    let targets = [];
    let angle = -Math.PI / 2 + 0.6;
    let lastPaint = 0;
    let inView = false;

    /** Sizes the canvas to the stage and lays out the glyph grid. */
    function resize() {
      const width = stage.clientWidth;
      if (!width || isHidden()) return;
      const small = width < 520;
      const cellWidth = small ? 6 : 7;
      const cellHeight = small ? 9 : 10;
      const firstSize = !size;
      size = width;
      half = width / 2;
      radar.size([canvas, base], { width: size, height: size });
      cells = layoutCells(cellWidth, cellHeight);
      if (firstSize) onFirstSize();
      repaint();
    }

    /**
     * The glyph grid inside the radar's rim.
     * @param {number} cellWidth Pixels.
     * @param {number} cellHeight Pixels.
     * @return {!Array<!FieldCell>}
     */
    function layoutCells(cellWidth, cellHeight) {
      const limit = half * RIM;
      const cols = Math.floor(limit / cellWidth);
      const rows = Math.floor(limit / cellHeight);
      /** @type {!Array<!FieldCell>} */
      const result = [];
      for (let col = -cols; col <= cols; col++) {
        for (let row = -rows; row <= rows; row++) {
          const x = col * cellWidth;
          const y = row * cellHeight;
          if (Math.hypot(x, y) > limit) continue;
          result.push({
            x: half + x,
            y: half + y,
            theta: Math.atan2(y, x),
            glyph: radar.gridGlyph(col, row),
            axis: col === 0 || row === 0,
            echo: 0,
          });
        }
      }
      return result;
    }

    /**
     * Draws a dotted ring on the static layer.
     * @param {number} fraction Radius as a fraction of the half-width.
     * @param {number} tone Index into tones.
     */
    function dottedRing(fraction, tone) {
      baseCtx.fillStyle = tones[tone];
      radar.ringDots(baseCtx, {
        cx: half,
        cy: half,
        radius: fraction * half,
        spacing: 6,
        minDots: 16,
      });
    }

    /**
     * A point on the bearing scale.
     * @param {number} degrees
     * @param {number} fraction Distance from the centre, of the half-width.
     * @return {[number, number]} [x, y] in pixels.
     */
    function scalePoint(degrees, fraction) {
      const a = -Math.PI / 2 + (degrees * Math.PI) / 180;
      return [
        half + Math.cos(a) * half * fraction,
        half + Math.sin(a) * half * fraction,
      ];
    }

    /** Paints the static layer: grid, rings, unlinked pieces, scale. */
    function paintBase() {
      baseCtx.clearRect(0, 0, size, size);
      for (const cell of cells) {
        if (!cell.glyph) continue;
        baseCtx.fillStyle = tones[cell.axis ? 34 : 17];
        baseCtx.fillText(cell.glyph, cell.x, cell.y);
      }
      if (layout.mode === 'zoom') {
        for (const radius of layout.zoomRadii()) {
          dottedRing(radius, 40);
        }
      } else {
        collectionData.forEach((collection, ring) => {
          const empty = layout.mode === 'summary' && !layout.ringCounts[ring];
          dottedRing(layout.ringRadius(ring), empty ? 22 : 46);
        });
      }
      dottedRing(RIM, 26);
      paintUnlinkedPieces();
      // Bearing scale: a mark every 10°, crosses every 30°, labels at the
      // cardinal points.
      for (let degrees = 0; degrees < 360; degrees += 10) {
        baseCtx.fillStyle = tones[degrees % 90 ? 32 : 64];
        baseCtx.fillText(
          degrees % 30 ? '.' : '+',
          ...scalePoint(degrees, 0.88),
        );
      }
      baseCtx.font = '9px monospace';
      baseCtx.fillStyle = tones[72];
      for (const degrees of [0, 90, 180, 270]) {
        baseCtx.fillText(pad(degrees, 3), ...scalePoint(degrees, 0.93));
      }
      baseCtx.font = '11px monospace';
    }

    /**
     * Pieces without a blip: filtered-out ones as faint dots and, in
     * summary, everything in range as a density band.
     */
    function paintUnlinkedPieces() {
      const plotted = new Set(layout.shown);
      const pool =
        layout.mode === 'zoom'
          ? products.filter(piece => piece.collection === layout.zoomRing)
          : products;
      for (const piece of pool) {
        if (plotted.has(piece)) continue;
        const inRange = layout.isVisible(piece);
        if (layout.mode !== 'summary' && inRange) continue;
        baseCtx.fillStyle = tones[inRange ? 66 : 18];
        const [left, top] = layout.pointOf(piece);
        baseCtx.fillText(
          inRange ? ':' : '.',
          (left / 100) * size,
          (top / 100) * size,
        );
      }
    }

    /**
     * Paints one frame: the static layer, then (unless motion is reduced)
     * the sweep, its afterglow and any pings.
     * @param {number} now
     */
    function paint(now) {
      if (!size || (!motion.matches && now - lastPaint < radar.FRAME_MS)) {
        return;
      }
      const dt = Math.min((now - lastPaint) / 1000, 0.05);
      const paintStart = performance.now();
      lastPaint = now;
      radar.drawBase(ctx, base, { width: size, height: size });
      if (motion.matches) return;
      angle = (angle - SWEEP_SPEED * dt) % radar.TAU;
      const decay = Math.exp(-dt / 0.9);
      for (const cell of cells) {
        const lag = radar.lag(cell.theta, angle);
        const strength =
          lag < SWEEP_WIDTH ? Math.pow(1 - lag / SWEEP_WIDTH, 1.6) : 0;
        cell.echo = Math.max(
          cell.echo * decay,
          strength > 0 ? 0.04 + strength * 0.1 : 0,
        );
        const brightness = Math.max(strength, cell.echo);
        if (brightness < 0.012) continue;
        ctx.fillStyle = tones[Math.round(12 + brightness * 70)];
        ctx.fillText(
          cell.glyph || radar.sweepGlyph(brightness),
          cell.x,
          cell.y,
        );
      }
      for (const target of targets) {
        const lag = radar.lag(target.angle, angle);
        if (lag < target.lag) ping(target, now);
        target.lag = lag;
      }
      radarPerf?.record('field paint', performance.now() - paintStart);
    }

    /**
     * Restarts a blip's ping animation and reports the ping.
     * @param {!PingTarget} target
     * @param {number} now
     */
    function ping(target, now) {
      target.element.classList.remove('ping');
      void target.element.offsetWidth; // restart the CSS animation
      target.element.classList.add('ping');
      onPing(target.piece, now);
    }

    /** Repaints the static layer and the current frame, once sized. */
    function repaint() {
      if (!size) return;
      paintBase();
      lastPaint = 0;
      paint(performance.now());
    }

    /**
     * Sets the blips the sweep pings: each at its bearing.
     * @param {!Array<!FieldBlip>} blips
     */
    function setTargets(blips) {
      targets = blips.map(({ piece, element }) => {
        const pieceAngle = -Math.PI / 2 + (piece.bearing * Math.PI) / 180;
        return {
          piece,
          element,
          angle: pieceAngle,
          lag: radar.lag(pieceAngle, angle),
        };
      });
    }

    const animation = radar.loop(
      paint,
      () => isActive() && inView && !document.hidden && !motion.matches,
    );

    /** Starts, stops or repaints to match the view, visibility and motion. */
    function sync() {
      if (!isActive()) {
        animation.stop();
        return;
      }
      if (!size) resize();
      if (!animation.sync()) {
        lastPaint = 0;
        paint(performance.now());
      }
    }

    stage.addEventListener('animationend', event => {
      const target = targetElement(event);
      if (target.classList.contains('blip')) target.classList.remove('ping');
    });
    new ResizeObserver(resize).observe(stage);
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    }).observe(stage);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    document.addEventListener('radar:theme', repaint);

    return { repaint, sync, setTargets, halfWidth: () => half };
  }

  return { mount };
})();
