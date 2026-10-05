/**
 * @fileoverview The homepage entrance radar: a full-screen ASCII radar behind
 * the intro. The sweep turns counterclockwise at a steady speed and briefly
 * speeds up when the visitor scrolls or wheels, easing back afterwards. The
 * canvas exposes its state as data-scan-angle, data-scan-speed,
 * data-swept-cells and data-afterglow-cells.
 */

/* exported homeEntrance */
/* global radar, tones */

const homeEntrance = (() => {
  // Radians of afterglow behind the sweep line.
  const SWEEP_WIDTH = 2.05;
  // Degrees per second.
  const BASE_SPEED = 14;
  // The most extra degrees per second that scrolling can add.
  const MAX_BOOST = 150;
  // Ring radii at a 1000 px reference size, scaled to the screen.
  const RING_RADII = [56, 126, 196, 266, 336, 406, 476];

  /**
   * Starts the radar.
   * @param {{
   *   section: !Element,
   *   canvas: !HTMLCanvasElement,
   *   motion: !MediaQueryList,
   * }} options section is the entrance the canvas fills; motion is the
   *     prefers-reduced-motion query (a still radar).
   */
  function mount({ section, canvas, motion }) {
    const context = canvas.getContext('2d');
    const base = document.createElement('canvas');
    const baseContext = base.getContext('2d');
    let width = 0;
    let height = 0;
    let cells = [];
    let ringPoints = [];
    let lastPaint = 0;
    let angle = -25; // degrees
    let speed = BASE_SPEED;
    let boost = 0;
    let lastTime = 0;
    let visible = true;
    let lastScroll = scrollY;
    let lastScrollTime = performance.now();

    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }).observe(section);

    /** Sizes the canvas to the entrance and lays out its grid and rings. */
    function resize() {
      const rect = section.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const small = width < 700;
      const cellWidth = small ? 6 : 7;
      const cellHeight = small ? 9 : 10;
      const font = `${small ? 10 : 11}px monospace`;
      radar.size([canvas, base], { width, height, font });
      const scale = (Math.max(width, height) * 1.58) / 1000;
      ringPoints = layoutRings(
        RING_RADII.map(radius => radius * scale),
        cellWidth,
      );
      cells = layoutCells(cellWidth, cellHeight);
      repaint();
    }

    /**
     * Dots for each ring. One repeated character at equal arc intervals keeps
     * every circle smooth, with identical weight, instead of uneven slash and
     * pipe combinations.
     * @param {!Array<number>} radii Pixels.
     * @param {number} spacing Pixels between dots.
     * @return {!Array<{x: number, y: number, theta: number}>}
     */
    function layoutRings(radii, spacing) {
      const points = [];
      for (const radius of radii) {
        const steps = Math.round((radar.TAU * radius) / spacing);
        for (let step = 0; step < steps; step++) {
          const theta = (step / steps) * radar.TAU;
          const x = width / 2 + Math.cos(theta) * radius;
          const y = height / 2 + Math.sin(theta) * radius;
          if (x < 0 || x > width || y < 0 || y > height) continue;
          points.push({ x, y, theta });
        }
      }
      return points;
    }

    /**
     * The glyph grid, centred on the screen.
     * @param {number} cellWidth Pixels.
     * @param {number} cellHeight Pixels.
     * @return {!Array<!Object>}
     */
    function layoutCells(cellWidth, cellHeight) {
      const columns = Math.ceil(width / cellWidth);
      const rows = Math.ceil(height / cellHeight);
      const middleCol = Math.floor(columns / 2);
      const middleRow = Math.floor(rows / 2);
      const result = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const x = width / 2 + (col - middleCol) * cellWidth;
          const y = height / 2 + (row - middleRow) * cellHeight;
          result.push({
            x,
            y,
            theta: Math.atan2(y - height / 2, x - width / 2),
            // A fixed per-cell offset for the shimmer.
            seed: (row * 197 + col * 53) % 997,
            glyph: radar.gridGlyph(col - middleCol, row - middleRow),
            axis: col === middleCol || row === middleRow,
            echo: 0,
          });
        }
      }
      return result;
    }

    /** Caches the static grid and rings; repainted when the theme changes. */
    function paintBase() {
      baseContext.clearRect(0, 0, width, height);
      for (const cell of cells) {
        if (!cell.glyph) continue;
        baseContext.fillStyle = tones[cell.axis ? 34 : 17];
        baseContext.fillText(cell.glyph, cell.x, cell.y);
      }
      baseContext.fillStyle = tones[59];
      for (const point of ringPoints) {
        baseContext.fillText('.', point.x, point.y);
      }
    }

    /** Publishes the angle and speed on the canvas, then paints. */
    function drawAngle() {
      canvas.dataset.scanAngle = angle.toFixed(2);
      canvas.dataset.scanSpeed = speed.toFixed(1);
      paint(performance.now());
    }

    /**
     * Paints one frame: the cached base, the lit cells and the rings the
     * sweep is crossing.
     * @param {number} now
     */
    function paint(now) {
      if (!width || (!motion.matches && now - lastPaint < radar.FRAME_MS)) {
        return;
      }
      const dt = Math.min((now - lastPaint) / 1000, 0.05);
      lastPaint = now;
      radar.drawBase(context, base, { width, height });
      const radians = (angle * Math.PI) / 180;
      const decay = Math.exp(-dt / 0.85);
      let sweptCells = 0;
      let afterglowCells = 0;
      for (const cell of cells) {
        // Every cell in the broad sweep is drawn. Glyph weight and brightness
        // form the gradient; texture never removes cells.
        const lag = radar.lag(cell.theta, radians);
        const strength =
          lag < SWEEP_WIDTH ? Math.pow(1 - lag / SWEEP_WIDTH, 1.55) : 0;
        cell.echo = Math.max(
          cell.echo * decay,
          strength > 0 ? 0.06 + strength * 0.14 : 0,
        );
        if (!strength && cell.echo < 0.006) continue;
        if (strength) {
          sweptCells++;
        } else {
          afterglowCells++;
        }
        const shimmer = 1 + Math.sin(now * 0.0018 + cell.seed * 0.17) * 0.055;
        const brightness = Math.max(strength, cell.echo) * shimmer;
        context.fillStyle = tones[Math.round(13 + brightness * 77)];
        context.fillText(
          cell.glyph || radar.sweepGlyph(brightness),
          cell.x,
          cell.y,
        );
      }
      // Ring dots brighten as the sweep passes over them.
      for (const point of ringPoints) {
        const lag = radar.lag(point.theta, radians);
        if (lag >= SWEEP_WIDTH) continue;
        const glow = Math.pow(1 - lag / SWEEP_WIDTH, 1.55);
        context.fillStyle = tones[Math.round(59 + glow * 30)];
        context.fillText('.', point.x, point.y);
      }
      canvas.dataset.sweptCells = String(sweptCells);
      canvas.dataset.afterglowCells = String(afterglowCells);
    }

    /** Repaints the base and the current frame. */
    function repaint() {
      paintBase();
      lastPaint = 0;
      paint(performance.now());
    }

    /**
     * Advances one frame: the scroll boost decays, the speed eases towards
     * base plus boost, and the sweep turns.
     * @param {number} now
     */
    function advance(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      boost *= Math.exp(-dt * 2.8);
      speed += (BASE_SPEED + boost - speed) * (1 - Math.exp(-dt * 9));
      angle = (angle - speed * dt) % 360;
      drawAngle();
    }

    const animation = radar.loop(
      advance,
      () => visible && !document.hidden && !motion.matches,
    );

    /** Starts or stops the animation to match visibility and motion. */
    function sync() {
      if (animation.sync()) lastTime = performance.now();
    }

    /**
     * Speeds the sweep up, up to MAX_BOOST.
     * @param {number} amount Degrees per second.
     */
    function accelerate(amount) {
      if (visible && !motion.matches) {
        boost = Math.min(MAX_BOOST, Math.max(boost, amount));
      }
    }

    new ResizeObserver(resize).observe(section);
    addEventListener(
      'wheel',
      event => accelerate(Math.abs(event.deltaY) * 0.65),
      { passive: true },
    );
    addEventListener(
      'scroll',
      () => {
        const now = performance.now();
        const distance = Math.abs(scrollY - lastScroll);
        const elapsed = Math.max(16, now - lastScrollTime);
        accelerate((distance / elapsed) * 55);
        lastScroll = scrollY;
        lastScrollTime = now;
      },
      { passive: true },
    );
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', () => {
      cells.forEach(cell => {
        cell.echo = 0;
      });
      sync();
      paint(performance.now());
    });
    document.addEventListener('radar:theme', repaint);

    resize();
    drawAngle();
    sync();
  }

  return { mount };
})();
