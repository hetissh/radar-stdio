/**
 * @fileoverview Drawing helpers shared by the site's four ASCII radars (the
 * homepage entrance and collection arcs, the catalogue field, the product
 * lock-on).
 *
 * A radar is a grid of monospace glyphs on a <canvas>. The static layer (grid
 * marks, rings) is painted once into an offscreen "base" canvas and copied
 * each frame; the sweep then lights each cell by how far it trails the sweep
 * angle, leaving an echo that decays. Colours come from the theme's tones.
 */

/* exported radar */
/* global clamp */

const radar = (() => {
  const TAU = Math.PI * 2;
  // Sharper than 1x on high-density screens, without the drawing cost of 2x
  // or 3x.
  const MAX_PIXEL_RATIO = 1.5;
  // About 30 fps: the sweep still reads as smooth at half the cost of 60.
  const FRAME_MS = 33;

  /**
   * Sizes canvases for a box of CSS pixels and sets the text style every
   * radar draws with.
   * @param {!Array<!HTMLCanvasElement>} canvases
   * @param {{width: number, height: number, font: (string|undefined)}} box
   */
  function size(canvases, box) {
    const { width, height, font = '11px monospace' } = box;
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

  /**
   * How far a point trails a sweep line.
   * @param {number} theta The point's angle, in radians.
   * @param {number} angle The sweep's angle, in radians.
   * @return {number} Radians behind the sweep, from 0 up to 2π.
   */
  function lag(theta, angle) {
    return (((theta - angle) % TAU) + TAU) % TAU;
  }

  /**
   * The static grid mark for a cell: '+' where every 16th column crosses
   * every 10th row, '|' and '-' along them, '' elsewhere.
   * @param {number} col Column, counted from the radar's centre.
   * @param {number} row Row, counted from the radar's centre.
   * @return {string}
   */
  function gridGlyph(col, row) {
    const vertical = col % 16 === 0;
    const horizontal = row % 10 === 0;
    if (vertical && horizontal) return '+';
    if (vertical) return '|';
    if (horizontal) return '-';
    return '';
  }

  /**
   * A lit cell's glyph, heavier as its brightness rises.
   * @param {number} brightness 0 to 1.
   * @return {string}
   */
  function sweepGlyph(brightness) {
    if (brightness > 0.72) return '#';
    if (brightness > 0.43) return '+';
    if (brightness > 0.19) return ':';
    return '.';
  }

  /**
   * Draws a dotted circle: one '.' every `spacing` px of circumference, and
   * at least `minDots`.
   * @param {!CanvasRenderingContext2D} ctx Drawn in its current fill style.
   * @param {{cx: number, cy: number, radius: number, spacing: number,
   *     minDots: number}} circle
   */
  function ringDots(ctx, circle) {
    const { cx, cy, radius, spacing, minDots } = circle;
    const steps = Math.max(minDots, Math.round((TAU * radius) / spacing));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * TAU;
      ctx.fillText(
        '.',
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
      );
    }
  }

  /**
   * The same dotted circle as an SVG, for buttons and overlays.
   * @param {number} diameter Pixels.
   * @param {number=} dots Number of dots; by default one per 3 units.
   * @return {string}
   */
  function ringSvg(diameter, dots) {
    const radius = diameter / 2 - 0.5;
    const count = dots || Math.round((TAU * radius) / 3);
    return (
      `<svg class="ring-svg" viewBox="0 0 ${diameter} ${diameter}" ` +
      'aria-hidden="true">' +
      `<circle cx="${diameter / 2}" cy="${diameter / 2}" r="${radius}" ` +
      `pathLength="${count}"/></svg>`
    );
  }

  /**
   * How visible a mark is near foreground content, so the radar never
   * competes with the garment: marks fade smoothly from full strength down to
   * 8% underneath it.
   * @param {number} distance From the content's centre, where 1 is the edge
   *     of its ellipse.
   * @return {number} 0.08 to 1.
   */
  function fade(distance) {
    const edge = clamp((distance - 0.5) / 0.7, 0, 1);
    return 0.08 + 0.92 * edge * edge * (3 - 2 * edge);
  }

  /**
   * Copies the cached static layer onto the visible canvas, replacing the
   * last frame.
   * @param {!CanvasRenderingContext2D} ctx
   * @param {!HTMLCanvasElement} base
   * @param {{width: number, height: number}} box CSS pixels.
   */
  function drawBase(ctx, base, box) {
    ctx.clearRect(0, 0, box.width, box.height);
    ctx.drawImage(
      base,
      0,
      0,
      base.width,
      base.height,
      0,
      0,
      box.width,
      box.height,
    );
  }

  /**
   * A requestAnimationFrame loop that calls step(now) every frame while
   * canRun() is true.
   * @param {function(number)} step
   * @param {function(): boolean} canRun
   * @return {{stop: function(), sync: function(): boolean}} Call sync()
   *     whenever something canRun() depends on changes: it restarts the loop
   *     and returns true, or stops it and returns false.
   */
  function loop(step, canRun) {
    let frame = 0;

    /** @param {number} now */
    function tick(now) {
      frame = 0;
      if (!canRun()) return;
      step(now);
      frame = requestAnimationFrame(tick);
    }

    /** Cancels the next frame, if one is scheduled. */
    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    return {
      stop,
      /** @return {boolean} Whether the loop is now running. */
      sync() {
        stop();
        if (canRun()) frame = requestAnimationFrame(tick);
        return frame !== 0;
      },
    };
  }

  return {
    TAU,
    FRAME_MS,
    size,
    lag,
    gridGlyph,
    sweepGlyph,
    ringDots,
    ringSvg,
    fade,
    drawBase,
    loop,
  };
})();
