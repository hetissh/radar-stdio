// Product page lock-on radar: behind the garment, the sweep turns two and a quarter times, slows onto the piece's
// bearing and locks, while a reticle closes in on the garment; then it idles with a slow, dim sweep.
// The readout above the stage counts "Scanning 000%" → "Locking" → "Signal locked / NN".
//
// Classic script (see shared.js): defines the global `productLock`. Uses shared.js and radar.js.
const productLock = (() => {
  const CELL_W = 7; // px between glyph columns
  const CELL_H = 10; // px between glyph rows
  const SWEEP_WIDTH = 1.7; // radians of afterglow behind the sweep line
  const SCAN_S = 1.6; // seconds the sweep takes to slow onto the bearing
  const LOCKED_S = 2; // seconds until the readout says "Signal locked"
  const easeOut = x => 1 - Math.pow(1 - x, 3);

  // Start the radar on the stage.
  //   stage    the .piece-stage section (holds the .lock-field canvas and .lock-state label)
  //   centre   the element the radar centres on and closes in around (the garment view)
  //   art      the garment's artwork <img>; layout is measured again once it loads
  //   bearing  the piece's bearing in degrees (where the sweep locks)
  //   number   the piece's number within its collection, for the readout
  //   motion   the prefers-reduced-motion media query (reduced motion: the locked state, no animation)
  /**
   *
   * @param root0
   * @param root0.stage
   * @param root0.centre
   * @param root0.art
   * @param root0.bearing
   * @param root0.number
   * @param root0.motion
   */
  function mount({ stage, centre, art, bearing, number, motion }) {
    const canvas = stage.querySelector('.lock-field');
    const ctx = canvas.getContext('2d');
    const base = document.createElement('canvas');
    const baseCtx = base.getContext('2d');
    const stateLabel = stage.querySelector('.lock-state');
    const lockAngle = -Math.PI / 2 + (bearing * Math.PI) / 180;
    const start = performance.now();
    let width = 0;
    let height = 0;
    let cells = [];
    let cx = 0;
    let cy = 0;
    let reticle = 0; // radius of the locked reticle, from the garment's size
    let lastPaint = 0;
    let visible = true;
    let lastLabel = '';

    /**
     *
     */
    function resize() {
      const rect = stage.getBoundingClientRect();
      const target = centre.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      radar.size([canvas, base], { width, height });
      cx = target.left + target.width / 2 - rect.left;
      cy = target.top + target.height / 2 - rect.top;
      reticle = Math.max(target.width, target.height) * 0.6;
      const rx = target.width * 0.6;
      const ry = target.height * 0.6;
      cells = [];
      for (
        let col = -Math.ceil(cx / CELL_W);
        col <= Math.ceil((width - cx) / CELL_W);
        col++
      ) {
        for (
          let row = -Math.ceil(cy / CELL_H);
          row <= Math.ceil((height - cy) / CELL_H);
          row++
        ) {
          const x = cx + col * CELL_W;
          const y = cy + row * CELL_H;
          cells.push({
            x,
            y,
            theta: Math.atan2(y - cy, x - cx),
            glyph: radar.gridGlyph(col, row),
            axis: col === 0 || row === 0,
            // Marks fade softly under the garment, as on the collection arcs.
            quiet: radar.fade(Math.hypot((x - cx) / rx, (y - cy) / ry)),
            echo: 0,
          });
        }
      }
      repaint();
    }

    /**
     *
     */
    function paintBase() {
      baseCtx.clearRect(0, 0, width, height);
      for (const cell of cells) {
        if (!cell.glyph) continue;
        baseCtx.fillStyle =
          tones[Math.round((cell.axis ? 34 : 17) * cell.quiet)];
        baseCtx.fillText(cell.glyph, cell.x, cell.y);
      }
      baseCtx.fillStyle = tones[30];
      radar.ringDots(baseCtx, {
        cx,
        cy,
        radius: reticle * 1.55,
        spacing: 7,
        minDots: 12,
      });
      baseCtx.fillStyle = tones[22];
      radar.ringDots(baseCtx, {
        cx,
        cy,
        radius: reticle * 2.2,
        spacing: 7,
        minDots: 12,
      });
    }

    /**
     *
     * @param now
     */
    function paint(now) {
      if (!width || (!motion.matches && now - lastPaint < radar.FRAME_MS)) {
        return;
      }
      const dt = Math.min((now - lastPaint) / 1000, 0.05);
      lastPaint = now;
      const t = motion.matches ? 99 : (now - start) / 1000; // seconds since the page opened
      const scan = clamp(t / SCAN_S, 0, 1);
      // Two and a quarter turns that decelerate onto the bearing, then a slow, dim idle sweep.
      const angle =
        t < SCAN_S
          ? lockAngle + radar.TAU * 2.25 * (1 - easeOut(scan))
          : lockAngle - (t - SCAN_S) * 0.3;
      const intensity = motion.matches
        ? 0
        : t < SCAN_S
          ? 1
          : Math.max(0.3, 1 - (t - SCAN_S) * 0.7);
      const lock = easeOut(clamp((t - 1.1) / 0.9, 0, 1)); // 0 → 1 as the reticle closes in
      const decay = Math.exp(-dt / 0.85);
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
      paintReticle(lock);
      const label =
        t < SCAN_S
          ? `Scanning ${pad(Math.round(scan * 100), 3)}%`
          : t < LOCKED_S
            ? 'Locking'
            : `Signal locked / ${number}`;
      if (label !== lastLabel) {
        stateLabel.textContent = label;
        lastLabel = label;
        stage.classList.toggle('locked', t >= LOCKED_S);
      }
    }

    // The reticle closes in from a wide ring onto the garment, then a beam of dots marks the piece's bearing.
    /**
     *
     * @param lock
     */
    function paintReticle(lock) {
      const r = reticle * (1 + 1.6 * (1 - lock));
      ctx.fillStyle = tones[Math.round(30 + 48 * lock)];
      radar.ringDots(ctx, { cx, cy, radius: r, spacing: 7, minDots: 12 });
      // Tick marks at the four compass points, fading outwards.
      for (let k = 0; k < 4; k++) {
        const a = (k * radar.TAU) / 4;
        for (let j = 0; j < 3; j++) {
          ctx.fillStyle = tones[Math.round((70 - j * 18) * lock)];
          ctx.fillText(
            k % 2 ? '|' : '-',
            cx + Math.cos(a) * (r + 9 + j * 9),
            cy + Math.sin(a) * (r + 9 + j * 9),
          );
        }
      }
      if (lock <= 0) return;
      ctx.fillStyle = tones[Math.round(46 * lock)];
      for (let d = r + 40; d < Math.hypot(width, height); d += 9) {
        const x = cx + Math.cos(lockAngle) * d;
        const y = cy + Math.sin(lockAngle) * d;
        if (x < 0 || y < 0 || x > width || y > height) break;
        ctx.fillText(':', x, y);
      }
    }

    /**
     *
     */
    function repaint() {
      paintBase();
      lastPaint = 0;
      paint(performance.now());
    }

    const animation = radar.loop(
      paint,
      () => visible && !document.hidden && !motion.matches,
    );
    /**
     *
     */
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
