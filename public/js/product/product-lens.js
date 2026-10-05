/**
 * @fileoverview The product page's "Art detail" lens: a round magnifier over
 * the garment's artwork (front view) or a photo. It follows the mouse, or a
 * finger or pen while pressed, and moves with the arrow keys; Escape closes
 * it. The full-resolution image loads only when the lens opens.
 *
 * product-media.js tells it which view is showing through the controller
 * returned by productLens.mount().
 */

/* exported productLens */
/* global pad, clamp, element, radar */

/**
 * What the lens can inspect in the current view.
 * @typedef {object} LensView
 * @property {boolean} inspectable Whether the lens is available.
 * @property {boolean} photo A photo (rather than the garment's artwork).
 * @property {!HTMLImageElement} image The image as drawn, to measure.
 * @property {!HTMLElement} surface The element showing the view.
 * @property {string} fullSrc The full-resolution image for the lens.
 */

const productLens = (() => {
  // Magnification of photos and of garment artwork.
  const PHOTO_ZOOM = 2.4;
  const ARTWORK_ZOOM = 3.2;
  // Fraction of the image the lens moves per arrow key press.
  const KEY_STEP = 0.05;

  /**
   * @param {!Piece} piece
   * @return {string} HTML for the lens overlay.
   */
  function markup(piece) {
    return (
      `<div class="loupe ${piece.dark ? 'dark-tee' : 'chalk'}" hidden ` +
      `aria-hidden="true">${radar.ringSvg(200, 140)}` +
      '<span class="loupe-cross">+</span>' +
      '<span class="loupe-coords mono"></span></div>'
    );
  }

  /** @return {string} HTML for the lens's toggle button. */
  function toggleMarkup() {
    return '<button class="loupe-toggle" aria-pressed="false">Art detail +</button>';
  }

  /**
   * Wires up the lens in the stage.
   * @param {!HTMLElement} stage The .piece-stage with markup() and
   *     toggleMarkup() inside it.
   * @return {{setView: function(!LensView): void, isOpen: function(): boolean}}
   */
  function mount(stage) {
    const lens = element(stage, '.loupe');
    const coords = element(lens, '.loupe-coords');
    const toggle = /** @type {!HTMLButtonElement} */ (
      element(stage, '.loupe-toggle')
    );
    const surfaces = [
      element(stage, '.piece-garment'),
      element(stage, '.media-frame'),
    ];
    /** @type {?LensView} */
    let view = null;
    let open = false;
    let centre = { x: 0.5, y: 0.5 }; // as fractions of the image

    /**
     * Where an image is actually drawn: images are contained in their box,
     * so measure the picture rather than the element.
     * @param {!HTMLImageElement} image
     * @return {{left: number, top: number, width: number, height: number}}
     */
    function imageRect(image) {
      const box = image.getBoundingClientRect();
      const naturalWidth = image.naturalWidth || 1;
      const naturalHeight = image.naturalHeight || 1;
      const scale = Math.min(
        box.width / naturalWidth,
        box.height / naturalHeight,
      );
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      return {
        left: box.left + (box.width - width) / 2,
        top: box.top + (box.height - height) / 2,
        width,
        height,
      };
    }

    /** Positions the lens over the image and pans its magnified copy. */
    function place() {
      if (!view) return;
      const image = imageRect(view.image);
      const stageRect = stage.getBoundingClientRect();
      const zoom = view.photo ? PHOTO_ZOOM : ARTWORK_ZOOM;
      const size = lens.offsetWidth;
      const left = image.left + centre.x * image.width - stageRect.left;
      const top = image.top + centre.y * image.height - stageRect.top;
      lens.style.left = `${left}px`;
      lens.style.top = `${top}px`;
      lens.style.backgroundSize = `${image.width * zoom}px ${image.height * zoom}px`;
      const panX = size / 2 - centre.x * image.width * zoom;
      const panY = size / 2 - centre.y * image.height * zoom;
      lens.style.backgroundPosition = `${panX}px ${panY}px`;
      const x = pad(Math.round(centre.x * 100), 3);
      const y = pad(Math.round(centre.y * 100), 3);
      coords.textContent = `X ${x} / Y ${y}`;
    }

    /** Hides the lens and resets the surfaces and the toggle. */
    function close() {
      open = false;
      lens.hidden = true;
      for (const surface of surfaces) {
        surface.classList.remove('inspecting');
        surface.removeAttribute('tabindex');
        surface.removeAttribute('aria-label');
      }
      toggle.setAttribute('aria-pressed', 'false');
      toggle.textContent = 'Art detail +';
    }

    /** Opens the lens at the image's centre, loading the full image. */
    function openLens() {
      // The page sets a view (setView) before the lens can be used.
      if (!view) return;
      close();
      open = true;
      lens.hidden = false;
      toggle.setAttribute('aria-pressed', 'true');
      toggle.textContent = 'Art detail −';
      lens.classList.toggle('photo', view.photo);
      lens.style.backgroundImage = `url("${view.fullSrc}")`;
      centre = { x: 0.5, y: 0.5 };
      const target = view.surface;
      target.classList.add('inspecting');
      target.tabIndex = 0;
      target.setAttribute(
        'aria-label',
        'Art detail lens. Use the arrow keys to move it, Escape to close.',
      );
      place();
    }

    /**
     * Follows a mouse, or a finger or pen while pressed.
     * @param {!PointerEvent} event
     */
    function follow(event) {
      const hovering =
        event.pointerType !== 'mouse' &&
        !event.buttons &&
        event.type === 'pointermove';
      if (!open || hovering || !view) return;
      const image = imageRect(view.image);
      centre = {
        x: clamp((event.clientX - image.left) / image.width, 0, 1),
        y: clamp((event.clientY - image.top) / image.height, 0, 1),
      };
      place();
    }

    /**
     * Arrow keys move the lens; Escape closes it.
     * @param {!KeyboardEvent} event
     */
    function nudge(event) {
      if (!open) return;
      if (event.key === 'Escape') {
        close();
        toggle.focus();
        return;
      }
      /** @type {!Record<string, [number, number]>} */
      const moves = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      event.stopPropagation();
      centre = {
        x: clamp(centre.x + move[0] * KEY_STEP, 0, 1),
        y: clamp(centre.y + move[1] * KEY_STEP, 0, 1),
      };
      place();
    }

    /**
     * Tells the lens which view is showing; switching views closes it.
     * @param {!LensView} next
     */
    function setView(next) {
      if (open) close();
      view = next;
      toggle.disabled = !next.inspectable;
    }

    toggle.addEventListener('click', () => {
      if (open) {
        close();
      } else {
        openLens();
      }
    });
    for (const surface of surfaces) {
      surface.addEventListener('pointermove', follow);
      surface.addEventListener('pointerdown', follow);
      surface.addEventListener('keydown', nudge);
    }
    toggle.addEventListener('keydown', nudge);
    addEventListener('resize', () => {
      if (open) place();
    });

    return { setView, isOpen: () => open };
  }

  return { markup, toggleMarkup, mount };
})();
