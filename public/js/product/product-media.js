/**
 * @fileoverview The product page's media viewer. The stage shows one view at
 * a time (the garment's front or back, a photo or a video), chosen from a
 * strip of buttons (a radio group), with the arrow keys or by swiping, with a
 * radar-wipe between views. The art-detail lens is product-lens.js.
 *
 * A piece's views come from its `media` list (see MediaItem in core/data.js);
 * without one it shows the garment's front and back.
 */

/* exported productMedia */
/* global esc, pad, remoteArt, cdnWidth, productLens */

const productMedia = (() => {
  const DEFAULT_MEDIA = [
    { type: 'garment', side: 'front', label: 'Front' },
    { type: 'garment', side: 'back', label: 'Back' },
  ];
  // The media frame's display width, for choosing an image size.
  const MEDIA_SIZES = '(max-width: 900px) 90vw, 55vw';
  // Pixels: a swipe travels at least SWIPE_MIN_X sideways and less than
  // SWIPE_MAX_Y vertically (more is a scroll).
  const SWIPE_MIN_X = 70;
  const SWIPE_MAX_Y = 50;

  /**
   * @param {!Piece} piece
   * @return {!Array<!MediaItem>} The piece's views.
   */
  function mediaList(piece) {
    return piece.media && piece.media.length ? piece.media : DEFAULT_MEDIA;
  }

  /**
   * A thumbnail from scripts/build_images.py: the path with / as --, then
   * -<width>.<ext>.
   * @param {string} src Relative to assets/.
   * @param {number} width
   * @param {string} ext
   * @return {string}
   */
  function mediaThumb(src, width, ext) {
    const name = src.replace(/\.[a-z0-9]+$/i, '').replace(/\//g, '--');
    return `assets/thumbs/${name}-${width}.${ext}`;
  }

  /**
   * @param {string} src
   * @param {string} ext
   * @return {string} A srcset of the 640 and 1280 px thumbnails.
   */
  function mediaSrcset(src, ext) {
    return (
      `${mediaThumb(src, 640, ext)} 640w, ` +
      `${mediaThumb(src, 1280, ext)} 1280w`
    );
  }

  /**
   * The still image that stands for an item: a photo, or a video's poster.
   * @param {!MediaItem} item
   * @return {string} Empty for garment views.
   */
  function stillOf(item) {
    if (item.type === 'image') return item.src;
    if (item.type === 'video') return item.poster;
    return '';
  }

  /**
   * The stage's media layers (placed after the garment) and the controls
   * below them.
   * @param {!Piece} piece
   * @return {string} HTML.
   */
  function markup(piece) {
    const strip = mediaList(piece)
      .map((item, i) => {
        const still = stillOf(item);
        const peek = still
          ? '<span class="media-peek" aria-hidden="true">' +
            `<img src="${esc(mediaThumb(still, 160, 'jpg'))}" alt="" ` +
            'loading="lazy"></span>'
          : '';
        const play = item.type === 'video' ? ' ▶' : '';
        return (
          '<button role="radio" aria-checked="false" tabindex="-1" ' +
          `data-media="${i}"><span class="media-no">${pad(i + 1)}</span>` +
          `${esc(item.label)}${play}${peek}</button>`
        );
      })
      .join('');
    return (
      `<div class="media-frame" hidden></div>` +
      `<button class="media-pause mono" hidden>Pause loop ‖</button>${productLens.markup(
        piece,
      )}<div class="view-controls mono">` +
      `<div class="media-strip" role="radiogroup" ` +
      `aria-label="Views of ${esc(piece.name)}">${strip}</div>` +
      `<p class="visually-hidden" aria-live="polite" id="media-status"></p>` +
      `${productLens.toggleMarkup()}</div>`
    );
  }

  /**
   * Wires up the viewer.
   * @param {{
   *   stage: !HTMLElement,
   *   piece: !Piece,
   *   motion: !MediaQueryList,
   * }} options stage is the .piece-stage holding the garment and markup();
   *     motion is the prefers-reduced-motion query (no wipes, no autoplay).
   */
  function mount({ stage, piece, motion }) {
    const media = mediaList(piece);
    const garment = stage.querySelector('.piece-garment');
    const teeView = stage.querySelector('.tee-view');
    const tee = stage.querySelector('.concept-tee');
    const artImage = tee.querySelector('.tee-art');
    const strip = [...stage.querySelectorAll('[data-media]')];
    const frame = stage.querySelector('.media-frame');
    const pauseButton = stage.querySelector('.media-pause');
    const mediaState = stage.querySelector('.media-state');
    const mediaStatus = stage.querySelector('#media-status');
    /** @type {!Map<number, !HTMLElement>} Built on first view and kept. */
    const elements = new Map();
    const preloaded = new Set();
    let current = -1;
    let userPaused = false;
    let stageVisible = true;
    let swipe = null;

    /**
     * An item's <picture> or <video>, built on first view and kept, so a
     * video keeps its place when you come back to it.
     * @param {number} index
     * @return {!HTMLElement}
     */
    function elementFor(index) {
      if (elements.has(index)) return elements.get(index);
      const item = media[index];
      const template = document.createElement('template');
      template.innerHTML =
        item.type === 'image' ? imageHtml(item) : videoHtml(item);
      elements.set(index, template.content.firstElementChild);
      return elements.get(index);
    }

    /**
     * @param {!MediaItem} item
     * @return {string} A responsive <picture>.
     */
    function imageHtml(item) {
      return (
        '<picture><source type="image/avif" ' +
        `srcset="${esc(mediaSrcset(item.src, 'avif'))}" sizes="${MEDIA_SIZES}">` +
        '<img class="media-image" ' +
        `src="${esc(mediaThumb(item.src, 640, 'jpg'))}" ` +
        `srcset="${esc(mediaSrcset(item.src, 'jpg'))}" sizes="${MEDIA_SIZES}" ` +
        `alt="${esc(item.alt)}" decoding="async"></picture>`
      );
    }

    /**
     * A video: loops play muted, films get controls. preload="none": only
     * the poster loads until the video is shown.
     * @param {!MediaItem} item
     * @return {string}
     */
    function videoHtml(item) {
      const captions = item.captions
        ? `<track kind="captions" src="assets/${esc(item.captions)}" ` +
          'srclang="en" label="English" default>'
        : '';
      const playback = item.mode === 'loop' ? ' muted loop' : ' controls';
      return (
        '<video class="media-video" playsinline preload="none" ' +
        `poster="${esc(mediaThumb(item.poster, 1280, 'jpg'))}" ` +
        `aria-label="${esc(item.alt)}"${playback}>` +
        `<source src="assets/${esc(item.src)}" type="video/mp4">` +
        `${captions}</video>`
      );
    }

    /** @return {?HTMLVideoElement} The video showing, if any. */
    function activeVideo() {
      const item = media[current];
      return item && item.type === 'video' ? elements.get(current) : null;
    }

    /**
     * @param {!MediaItem|undefined} item
     * @return {boolean}
     */
    function isLoop(item) {
      return Boolean(item && item.type === 'video' && item.mode === 'loop');
    }

    /** Plays a looping video when it should be playing. */
    function playLoop() {
      const video = activeVideo();
      const shouldPlay =
        video &&
        isLoop(media[current]) &&
        !userPaused &&
        !motion.matches &&
        !document.hidden &&
        stageVisible;
      if (shouldPlay) {
        // Autoplay can be refused (e.g. power saving); the loop just stays
        // paused on its poster.
        video.play().catch(() => {});
      }
      syncPause();
    }

    /** Shows the pause button for loops, labelled for their state. */
    function syncPause() {
      const video = activeVideo();
      pauseButton.hidden = !isLoop(media[current]);
      if (video) {
        pauseButton.textContent = video.paused
          ? 'Play loop ▶'
          : 'Pause loop ‖';
      }
    }

    /**
     * What the lens can inspect in a view.
     * @param {!MediaItem} item
     * @param {number} index
     * @return {!LensView}
     */
    function lensView(item, index) {
      const photo = item.type === 'image';
      const fullArt = remoteArt(piece.image)
        ? cdnWidth(piece.image, 1600)
        : `assets/${piece.image}`;
      return {
        inspectable:
          photo || (item.type === 'garment' && item.side === 'front'),
        photo,
        image: photo ? elements.get(index).querySelector('img') : artImage,
        surface: item.type === 'garment' ? garment : frame,
        fullSrc: photo ? mediaThumb(item.src, 1280, 'jpg') : fullArt,
      };
    }

    /**
     * Switches the stage to a view.
     * @param {number} index
     * @return {boolean} Whether the view changed (false if already showing).
     */
    function showMedia(index) {
      if (index === current) return false;
      const item = media[index];
      activeVideo()?.pause();
      current = index;
      userPaused = false;
      strip.forEach((button, i) => {
        button.setAttribute('aria-checked', String(i === index));
        button.tabIndex = i === index ? 0 : -1;
      });
      let surface = frame;
      if (item.type === 'garment') {
        garment.classList.remove('media-hidden');
        frame.hidden = true;
        tee.classList.toggle('back', item.side === 'back');
        surface = teeView;
      } else {
        // The garment stays laid out (invisibly) so the radar keeps its
        // centre.
        garment.classList.add('media-hidden');
        frame.hidden = false;
        frame.replaceChildren(elementFor(index));
      }
      lens.setView(lensView(item, index));
      const position = `${pad(index + 1)} / ${pad(media.length)}`;
      mediaState.textContent = `Media ${position} · ${item.label}`;
      if (!motion.matches && stage.dataset.ready) {
        surface.classList.remove('wipe');
        void surface.offsetWidth; // restart the CSS animation
        surface.classList.add('wipe');
      }
      playLoop();
      preloadNext(index);
      return true;
    }

    /**
     * Announces the view for screen readers.
     * @param {number} index
     */
    function announce(index) {
      const label = media[index].label;
      mediaStatus.textContent = `${label}, ${index + 1} of ${media.length}`;
    }

    /**
     * The view `step` places from the current one, wrapping around.
     * @param {number} step
     * @return {number}
     */
    function stepFrom(step) {
      return (current + step + media.length) % media.length;
    }

    /**
     * Fetches the next item's image (or poster) ahead of time, so moving on
     * feels instant.
     * @param {number} index
     */
    function preloadNext(index) {
      const next = (index + 1) % media.length;
      const item = media[next];
      const still = stillOf(item);
      if (!still || preloaded.has(next)) return;
      preloaded.add(next);
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      if (item.type === 'image') {
        link.setAttribute('imagesrcset', mediaSrcset(still, 'avif'));
        link.setAttribute('imagesizes', MEDIA_SIZES);
        link.type = 'image/avif';
      } else {
        link.href = mediaThumb(still, 1280, 'jpg');
      }
      document.head.append(link);
    }

    /**
     * Radio-group keys on the strip: arrows step, Home and End jump.
     * @param {!KeyboardEvent} event
     */
    function onStripKey(event) {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
        event.key
      ];
      let target = null;
      if (step) {
        target = stepFrom(step);
      } else if (event.key === 'Home') {
        target = 0;
      } else if (event.key === 'End') {
        target = media.length - 1;
      }
      if (target === null) return;
      event.preventDefault();
      if (!showMedia(target)) return;
      strip[target].focus();
      announce(target);
    }

    /** Pauses or resumes the looping video. */
    function togglePause() {
      const video = activeVideo();
      if (!video) return;
      if (video.paused) {
        userPaused = false;
        video.play().catch(() => {
          // Playback refused: the button keeps offering "Play".
        });
      } else {
        userPaused = true;
        video.pause();
      }
      syncPause();
    }

    strip.forEach((button, index) => {
      button.addEventListener('click', () => {
        if (showMedia(index)) announce(index);
      });
      button.addEventListener('keydown', onStripKey);
    });
    for (const element of [teeView, frame]) {
      element.addEventListener('animationend', () =>
        element.classList.remove('wipe'),
      );
    }
    pauseButton.addEventListener('click', togglePause);
    // Media events don't bubble; capture them from the frame.
    frame.addEventListener('play', syncPause, true);
    frame.addEventListener('pause', syncPause, true);
    // Video pauses when the stage scrolls away or the tab is hidden; a loop
    // resumes when it comes back.
    new IntersectionObserver(([entry]) => {
      stageVisible = entry.isIntersecting;
      const video = activeVideo();
      if (!stageVisible && video) {
        video.pause();
      } else {
        playLoop();
      }
    }).observe(stage);
    document.addEventListener('visibilitychange', () => {
      const video = activeVideo();
      if (document.hidden && video) {
        video.pause();
      } else {
        playLoop();
      }
    });
    motion.addEventListener('change', () => {
      const video = activeVideo();
      if (motion.matches && video && media[current].mode === 'loop') {
        video.pause();
      } else {
        playLoop();
      }
    });

    const lens = productLens.mount(stage);
    showMedia(0);
    stage.dataset.ready = '1';

    // Swipes between views (touch and pen).
    stage.addEventListener(
      'pointerdown',
      event => {
        const swipeable =
          event.pointerType !== 'mouse' &&
          !lens.isOpen() &&
          !event.target.closest('video,button');
        if (swipeable) swipe = { x: event.clientX, y: event.clientY };
      },
      { passive: true },
    );
    stage.addEventListener('pointerup', event => {
      if (!swipe) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      swipe = null;
      const isSwipe =
        Math.abs(dx) > SWIPE_MIN_X &&
        Math.abs(dy) < SWIPE_MAX_Y &&
        media.length > 1;
      if (!isSwipe) return;
      const target = stepFrom(dx < 0 ? 1 : -1);
      if (showMedia(target)) announce(target);
    });
    stage.addEventListener('pointercancel', () => {
      swipe = null;
    });
  }

  return { markup, mount };
})();
