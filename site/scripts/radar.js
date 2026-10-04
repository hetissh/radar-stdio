// Radar canvas toolkit: drawing primitives shared by the site's ASCII radars.
//
// A radar is a grid of monospace glyphs on a <canvas>. The static layer (grid marks, rings) is painted once into
// an offscreen "base" canvas and copied each frame; the sweep then lights each cell by how far it trails the
// sweep angle, leaving an echo that decays. Colours come from the theme's tones[] scale in shared.js.
//
// Classic script (see shared.js): defines the global `radar`. Load after shared.js, before the page scripts.
const radar = (() => {
  const TAU = Math.PI * 2;
  // Sharper than 1x on high-density screens, without the drawing cost of 2x or 3x.
  const MAX_PIXEL_RATIO = 1.5;
  // ~30 fps: the sweep still reads as smooth at half the cost of 60.
  const FRAME_MS = 33;

  // Size canvases for a box of CSS pixels and set the text style every radar draws with.
  function size(canvases, width, height, font = '11px monospace') {
    const dpr = Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO);
    for (const canvas of canvases) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }
  }

  // How far (0 to 2π radians) a point at `theta` trails a sweep pointing at `angle`.
  const lag = (theta, angle) => (((theta - angle) % TAU) + TAU) % TAU;

  // Static grid marks: '+' where every 16th column crosses every 10th row, '|' and '-' along them.
  function gridGlyph(col, row) {
    const vertical = col % 16 === 0;
    const horizontal = row % 10 === 0;
    return vertical && horizontal ? '+' : vertical ? '|' : horizontal ? '-' : '';
  }

  // A lit cell's glyph gets heavier as its brightness (0–1) rises.
  const sweepGlyph = brightness =>
    brightness > 0.72 ? '#' : brightness > 0.43 ? '+' : brightness > 0.19 ? ':' : '.';

  // A dotted circle: one '.' every `spacing` px of circumference, and at least `minDots`.
  function ringDots(ctx, cx, cy, r, spacing, minDots) {
    const steps = Math.max(minDots, Math.round((TAU * r) / spacing));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU;
      ctx.fillText('.', cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }

  // Copy the cached static layer onto the visible canvas, replacing the last frame.
  function drawBase(ctx, base, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(base, 0, 0, base.width, base.height, 0, 0, width, height);
  }

  // A requestAnimationFrame loop that calls step(now) each frame while canRun() is true. Call sync() whenever
  // something canRun() depends on changes: it (re)starts the loop and returns true, or stops it and returns false.
  function loop(step, canRun) {
    let frame = 0;
    function tick(now) {
      frame = 0;
      if (!canRun()) return;
      step(now);
      frame = requestAnimationFrame(tick);
    }
    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
    return {
      stop,
      sync() {
        stop();
        if (canRun()) frame = requestAnimationFrame(tick);
        return frame !== 0;
      },
    };
  }

  return { TAU, FRAME_MS, size, lag, gridGlyph, sweepGlyph, ringDots, drawBase, loop };
})();
