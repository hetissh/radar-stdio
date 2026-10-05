// Homepage entrance radar: a full-screen ASCII radar behind the intro. The sweep turns counterclockwise at a
// steady speed and briefly speeds up when the visitor scrolls or wheels, easing back afterwards.
// The canvas exposes its state as data-scan-angle, data-scan-speed, data-swept-cells and data-afterglow-cells.
//
// Classic script (see shared.js): defines the global `homeEntrance`. Uses shared.js and radar.js.
const homeEntrance = (() => {
  const SWEEP_WIDTH = 2.05; // radians of afterglow behind the sweep line
  const BASE_SPEED = 14; // degrees per second
  const MAX_BOOST = 150; // most extra degrees per second that scrolling can add
  // Ring radii at a 1000px reference size, scaled to the screen.
  const RING_RADII = [56, 126, 196, 266, 336, 406, 476];

  // Start the radar on `canvas`, sized to `section` (the entrance). motion: the prefers-reduced-motion query.
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

    function resize() {
      const rect = section.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const small = width < 700;
      const cellWidth = small ? 6 : 7;
      const cellHeight = small ? 9 : 10;
      radar.size([canvas, base], width, height, (small ? 10 : 11) + 'px monospace');
      cells = [];
      ringPoints = [];
      const scale = (Math.max(width, height) * 1.58) / 1000;
      const rings = RING_RADII.map(r => r * scale);
      const columns = Math.ceil(width / cellWidth);
      const rows = Math.ceil(height / cellHeight);
      const middleCol = Math.floor(columns / 2);
      const middleRow = Math.floor(rows / 2);
      // One repeated character at equal arc intervals keeps every circle smooth, with identical weight,
      // instead of uneven slash and pipe combinations.
      for (const radius of rings) {
        const steps = Math.round((radar.TAU * radius) / cellWidth);
        for (let step = 0; step < steps; step++) {
          const theta = (step / steps) * radar.TAU;
          const x = width / 2 + Math.cos(theta) * radius;
          const y = height / 2 + Math.sin(theta) * radius;
          if (x < 0 || x > width || y < 0 || y > height) continue;
          ringPoints.push({ x, y, theta });
        }
      }
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const x = width / 2 + (col - middleCol) * cellWidth;
          const y = height / 2 + (row - middleRow) * cellHeight;
          cells.push({
            x,
            y,
            theta: Math.atan2(y - height / 2, x - width / 2),
            seed: (row * 197 + col * 53) % 997, // a fixed per-cell offset for the shimmer
            glyph: radar.gridGlyph(col - middleCol, row - middleRow),
            axis: col === middleCol || row === middleRow,
            echo: 0,
          });
        }
      }
      repaint();
    }

    // The static grid and rings are cached, then repainted when the theme changes.
    function paintBase() {
      baseContext.clearRect(0, 0, width, height);
      for (const cell of cells) {
        if (!cell.glyph) continue;
        baseContext.fillStyle = tones[cell.axis ? 34 : 17];
        baseContext.fillText(cell.glyph, cell.x, cell.y);
      }
      baseContext.fillStyle = tones[59];
      for (const point of ringPoints) baseContext.fillText('.', point.x, point.y);
    }

    function drawAngle() {
      canvas.dataset.scanAngle = angle.toFixed(2);
      canvas.dataset.scanSpeed = speed.toFixed(1);
      paint(performance.now());
    }

    function paint(now) {
      if (!width || (!motion.matches && now - lastPaint < radar.FRAME_MS)) return;
      const dt = Math.min((now - lastPaint) / 1000, 0.05);
      lastPaint = now;
      radar.drawBase(context, base, width, height);
      const radians = (angle * Math.PI) / 180;
      const decay = Math.exp(-dt / 0.85);
      let sweptCells = 0;
      let afterglowCells = 0;
      for (const cell of cells) {
        // Every cell in the broad sweep is drawn. Character weight and brightness form the gradient;
        // texture never removes cells or changes the structure.
        const lag = radar.lag(cell.theta, radians);
        const strength = lag < SWEEP_WIDTH ? Math.pow(1 - lag / SWEEP_WIDTH, 1.55) : 0;
        cell.echo = Math.max(cell.echo * decay, strength > 0 ? 0.06 + strength * 0.14 : 0);
        if (!strength && cell.echo < 0.006) continue;
        if (strength) sweptCells++;
        else afterglowCells++;
        const shimmer = 1 + Math.sin(now * 0.0018 + cell.seed * 0.17) * 0.055;
        const brightness = Math.max(strength, cell.echo) * shimmer;
        context.fillStyle = tones[Math.round(13 + brightness * 77)];
        context.fillText(cell.glyph || radar.sweepGlyph(brightness), cell.x, cell.y);
      }
      // Ring dots brighten as the sweep passes over them.
      for (const point of ringPoints) {
        const lag = radar.lag(point.theta, radians);
        if (lag >= SWEEP_WIDTH) continue;
        context.fillStyle = tones[Math.round(59 + Math.pow(1 - lag / SWEEP_WIDTH, 1.55) * 30)];
        context.fillText('.', point.x, point.y);
      }
      canvas.dataset.sweptCells = String(sweptCells);
      canvas.dataset.afterglowCells = String(afterglowCells);
    }

    function repaint() {
      paintBase();
      lastPaint = 0;
      paint(performance.now());
    }

    new ResizeObserver(resize).observe(section);

    // Each frame: the scroll boost decays, the speed eases towards base + boost, and the sweep turns.
    const animation = radar.loop(
      now => {
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        boost *= Math.exp(-dt * 2.8);
        speed += (BASE_SPEED + boost - speed) * (1 - Math.exp(-dt * 9));
        angle = (angle - speed * dt) % 360;
        drawAngle();
      },
      () => visible && !document.hidden && !motion.matches,
    );
    function sync() {
      if (animation.sync()) lastTime = performance.now();
    }

    function accelerate(amount) {
      if (visible && !motion.matches) boost = Math.min(MAX_BOOST, Math.max(boost, amount));
    }
    addEventListener('wheel', event => accelerate(Math.abs(event.deltaY) * 0.65), { passive: true });
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
