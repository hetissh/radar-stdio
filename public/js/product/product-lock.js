/**
 * @fileoverview The product page's lock-on radar. Behind the garment, the
 * sweep turns two and a quarter times, slows onto the piece's bearing and
 * locks, while a reticle closes in on the garment; then it idles with a slow,
 * dim sweep. The readout above the stage counts "Scanning 000%", then
 * "Locking", then "Signal locked / NN".
 */

/* exported productLock */
/* global pad, clamp, element, radar, tones */

/**
 * One glyph cell of the lock-on grid.
 * @typedef {object} LockCell
 * @property {number} x
 * @property {number} y
 * @property {number} theta Angle from the garment's centre, in radians.
 * @property {string} glyph The static grid mark, or ''.
 * @property {boolean} axis On the centre row or column.
 * @property {number} quiet How visible near the garment, 0.08 to 1.
 * @property {number} echo Afterglow, 0 to 1.
 */

const productLock = (() => {
  // Pixels between glyph columns and rows.
  const CELL_WIDTH = 7;
  const CELL_HEIGHT = 10;
  // Radians of afterglow behind the sweep line.
  const SWEEP_WIDTH = 1.7;
  // Seconds the sweep takes to slow onto the bearing.
  const SCAN_SECONDS = 1.6;
  // Seconds until the readout says "Signal locked".
  const LOCKED_SECONDS = 2;
  // Turns the sweep makes before it settles.
  const SCAN_TURNS = 2.25;

  /**
   * Eases out cubically: fast at first, settling at 1.
   * @param {number} progress 0 to 1.
   * @return {number}
   */
  function easeOut(progress) {
    return 1 - Math.pow(1 - progress, 3);
  }

  /**
   * Starts the radar on the stage.
   * @param {{
   *   stage: !HTMLElement,
   *   centre: !Element,
   *   art: !HTMLImageElement,
   *   bearing: number,
   *   number: string,
   *   motion: !MediaQueryList,
   * }} options stage is the .piece-stage (with the .lock-field canvas and
   *     .lock-state label); centre is what the radar centres on and closes
   *     in around (the garment); art is the garment's artwork, re-measured
   *     once loaded; bearing in degrees is where the sweep locks; number is
   *     the piece's number in its collection; motion is the
   *     prefers-reduced-motion query (shows the locked state, still).
   */
  function mount({ stage, centre, art, bearing, number, motion }) {
    const canvas = /** @type {!HTMLCanvasElement} */ (
      element(stage, '.lock-field')
    );
    const ctx = radar.context2d(canvas);
    const base = document.createElement('canvas');
    const baseCtx = radar.context2d(base);
    const stateLabel = element(stage, '.lock-state');
    const lockAngle = -Math.PI / 2 + (bearing * Math.PI) / 180;
    const start = performance.now();
    let width = 0;
    let height = 0;
    /** @type {!Array<!LockCell>} */
    let cells = [];
    let cx = 0;
    let cy = 0;
    let reticle = 0; // radius of the locked reticle, from the garment's size
    let lastPaint = 0;
    let visible = true;
    let lastLabel = '';

    /** Sizes the canvas to the stage and lays out the glyph grid. */
    function resize() {
      const rect = stage.getBoundingClientRect();
      const target = centre.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      radar.size([canvas, base], { width, height });
      cx = target.left + target.width / 2 - rect.left;
      cy = target.top + target.height / 2 - rect.top;
      reticle = Math.max(target.width, target.height) * 0.6;
      cells = layoutCells(target.width * 0.6, target.height * 0.6);
      repaint();
    }

    /**
     * The glyph grid, centred on the garment, fading softly under it as on
     * the homepage arcs.
     * @param {number} radiusX The garment's ellipse, in pixels.
     * @param {number} radiusY
     * @return {!Array<!LockCell>}
     */
    function layoutCells(radiusX, radiusY) {
      /** @type {!Array<!LockCell>} */
      const result = [];
      const firstCol = -Math.ceil(cx / CELL_WIDTH);
      const lastCol = Math.ceil((width - cx) / CELL_WIDTH);
      const firstRow = -Math.ceil(cy / CELL_HEIGHT);
      const lastRow = Math.ceil((height - cy) / CELL_HEIGHT);
      for (let col = firstCol; col <= lastCol; col++) {
        for (let row = firstRow; row <= lastRow; row++) {
          const x = cx + col * CELL_WIDTH;
          const y = cy + row * CELL_HEIGHT;
          const distance = Math.hypot((x - cx) / radiusX, (y - cy) / radiusY);
          result.push({
            x,
            y,
            theta: Math.atan2(y - cy, x - cx),
            glyph: radar.gridGlyph(col, row),
            axis: col === 0 || row === 0,
            quiet: radar.fade(distance),
            echo: 0,
          });
        }
      }
      return result;
    }

    /**
     * A dotted ring around the garment.
     * @param {!CanvasRenderingContext2D} context
     * @param {number} radius Pixels.
     */
    function dottedRing(context, radius) {
      radar.ringDots(context, { cx, cy, radius, spacing: 7, minDots: 12 });
    }

    /** Paints the static layer: the faded grid and two outer rings. */
    function paintBase() {
      baseCtx.clearRect(0, 0, width, height);
      for (const cell of cells) {
        if (!cell.glyph) continue;
        const tone = (cell.axis ? 34 : 17) * cell.quiet;
        baseCtx.fillStyle = tones[Math.round(tone)];
        baseCtx.fillText(cell.glyph, cell.x, cell.y);
      }
      baseCtx.fillStyle = tones[30];
      dottedRing(baseCtx, reticle * 1.55);
      baseCtx.fillStyle = tones[22];
      dottedRing(baseCtx, reticle * 2.2);
    }

    /**
     * Paints one frame of the scan, lock and idle sweep.
     * @param {number} now
     */
    function paint(now) {
      if (!width || (!motion.matches && now - lastPaint < radar.FRAME_MS)) {
        return;
      }
      const dt = Math.min((now - lastPaint) / 1000, 0.05);
      lastPaint = now;
      const seconds = motion.matches ? 99 : (now - start) / 1000;
      const scan = clamp(seconds / SCAN_SECONDS, 0, 1);
      const scanning = seconds < SCAN_SECONDS;
      // The turns decelerate onto the bearing, then a slow, dim idle sweep.
      const angle = scanning
        ? lockAngle + radar.TAU * SCAN_TURNS * (1 - easeOut(scan))
        : lockAngle - (seconds - SCAN_SECONDS) * 0.3;
      let intensity = 1;
      if (motion.matches) {
        intensity = 0;
      } else if (!scanning) {
        intensity = Math.max(0.3, 1 - (seconds - SCAN_SECONDS) * 0.7);
      }
      // 0 to 1 as the reticle closes in.
      const lock = easeOut(clamp((seconds - 1.1) / 0.9, 0, 1));
      paintSweep({ angle, intensity, decay: Math.exp(-dt / 0.85) });
      paintReticle(lock);
      updateLabel(seconds, scan);
    }

    /**
     * Draws the static layer, then the lit cells behind the sweep.
     * @param {{angle: number, intensity: number, decay: number}} sweep
     */
    function paintSweep({ angle, intensity, decay }) {
      radar.drawBase(ctx, base, { width, height });
      for (const cell of cells) {
        const lag = radar.lag(cell.theta, angle);
        const strength =
          lag < SWEEP_WIDTH
            ? Math.pow(1 - lag / SWEEP_WIDTH, 1.55) * intensity
            : 0;
        cell.echo = Math.max(
          cell.echo * decay,
          strength > 0 ? 0.05 + strength * 0.12 : 0,
        );
        const brightness = Math.max(strength, cell.echo);
        if (brightness < 0.01) continue;
        const shade = Math.round((13 + brightness * 77) * cell.quiet);
        if (shade < 3) continue;
        ctx.fillStyle = tones[shade];
        ctx.fillText(
          cell.glyph || radar.sweepGlyph(brightness),
          cell.x,
          cell.y,
        );
      }
    }

    /**
     * The reticle closes in from a wide ring onto the garment, then a beam
     * of dots marks the piece's bearing.
     * @param {number} lock 0 (wide) to 1 (locked).
     */
    function paintReticle(lock) {
      const radius = reticle * (1 + 1.6 * (1 - lock));
      ctx.fillStyle = tones[Math.round(30 + 48 * lock)];
      dottedRing(ctx, radius);
      // Tick marks at the four compass points, fading outwards.
      for (let quarter = 0; quarter < 4; quarter++) {
        const angle = (quarter * radar.TAU) / 4;
        for (let step = 0; step < 3; step++) {
          const distance = radius + 9 + step * 9;
          ctx.fillStyle = tones[Math.round((70 - step * 18) * lock)];
          ctx.fillText(
            quarter % 2 ? '|' : '-',
            cx + Math.cos(angle) * distance,
            cy + Math.sin(angle) * distance,
          );
        }
      }
      if (lock <= 0) return;
      ctx.fillStyle = tones[Math.round(46 * lock)];
      const reach = Math.hypot(width, height);
      for (let distance = radius + 40; distance < reach; distance += 9) {
        const x = cx + Math.cos(lockAngle) * distance;
        const y = cy + Math.sin(lockAngle) * distance;
        if (x < 0 || y < 0 || x > width || y > height) break;
        ctx.fillText(':', x, y);
      }
    }

    /**
     * Updates the readout when its text changes.
     * @param {number} seconds Since the page opened.
     * @param {number} scan 0 to 1 through the scan.
     */
    function updateLabel(seconds, scan) {
      let label = `Signal locked / ${number}`;
      if (seconds < SCAN_SECONDS) {
        label = `Scanning ${pad(Math.round(scan * 100), 3)}%`;
      } else if (seconds < LOCKED_SECONDS) {
        label = 'Locking';
      }
      if (label === lastLabel) return;
      stateLabel.textContent = label;
      lastLabel = label;
      stage.classList.toggle('locked', seconds >= LOCKED_SECONDS);
    }

    /** Repaints the static layer and the current frame. */
    function repaint() {
      paintBase();
      lastPaint = 0;
      paint(performance.now());
    }

    const animation = radar.loop(
      paint,
      () => visible && !document.hidden && !motion.matches,
    );

    /** Animates while visible, or paints one still frame. */
    function sync() {
      if (!animation.sync()) {
        lastPaint = 0;
        paint(performance.now());
      }
    }

    new ResizeObserver(resize).observe(stage);
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }).observe(stage);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', () => {
      cells.forEach(cell => {
        cell.echo = 0;
      });
      sync();
    });
    document.addEventListener('radar:theme', repaint);
    art.addEventListener('load', resize);
  }

  return { mount };
})();
