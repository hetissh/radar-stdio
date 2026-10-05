// Product page media viewer: the stage shows one view at a time — the garment front or back, a photo or a
// video — chosen from a strip of buttons (a radio group), by swiping, or with the arrow keys, with a radar-wipe
// between views. The "Art detail" lens magnifies the garment's artwork or a photo.
//
// A piece's views come from its `media` list in data/products.json; without one it shows the garment's front
// and back. Media items: { type: 'garment', side, label } | { type: 'image', src, alt, label }
// | { type: 'video', src, poster, alt, label, mode: 'loop' | 'film', captions? }. Paths are relative to assets/.
//
// Classic script (see shared.js): defines the global `productMedia`. Uses shared.js and radar.js.
const productMedia = (() => {
  const DEFAULT_MEDIA = [
    { type: 'garment', side: 'front', label: 'Front' },
    { type: 'garment', side: 'back', label: 'Back' },
  ];
  const MEDIA_SIZES = '(max-width: 900px) 90vw, 55vw'; // the media frame's display width, for srcset
  const LENS_ZOOM = { image: 2.4, garment: 3.2 };
  const LENS_STEP = 0.05; // fraction of the artwork the lens moves per arrow key press
  const SWIPE_MIN_X = 70; // px of horizontal travel that counts as a swipe
  const SWIPE_MAX_Y = 50; // px of vertical travel beyond which it is a scroll, not a swipe

  const mediaList = piece => (piece.media && piece.media.length ? piece.media : DEFAULT_MEDIA);
  // Thumbnails from scripts/build_images.py: the path with / as --, then -<width>.<ext>.
  const mediaThumb = (src, width, ext) =>
    'assets/thumbs/' + src.replace(/\.[a-z0-9]+$/i, '').replace(/\//g, '--') + '-' + width + '.' + ext;
  const mediaSrcset = (src, ext) => `${mediaThumb(src, 640, ext)} 640w, ${mediaThumb(src, 1280, ext)} 1280w`;
  // The still image that stands for an item in previews: a photo itself, or a video's poster.
  const stillOf = m => (m.type === 'image' ? m.src : m.type === 'video' ? m.poster : '');

  // The stage's media layers (placed after the garment) and the controls below them.
  function markup(piece) {
    const strip = mediaList(piece)
      .map((m, i) => {
        const still = stillOf(m);
        const peek = still
          ? `<span class="media-peek" aria-hidden="true"><img src="${esc(mediaThumb(still, 160, 'jpg'))}" alt="" loading="lazy"></span>`
          : '';
        return (
          `<button role="radio" aria-checked="false" tabindex="-1" data-media="${i}">` +
          `<span class="media-no">${pad(i + 1)}</span>${esc(m.label)}${m.type === 'video' ? ' ▶' : ''}${peek}</button>`
        );
      })
      .join('');
    return (
      '<div class="media-frame" hidden></div>' +
      '<button class="media-pause mono" hidden>Pause loop ‖</button>' +
      `<div class="loupe ${piece.dark ? 'dark-tee' : 'chalk'}" hidden aria-hidden="true">${radar.ringSvg(200, 140)}` +
      '<span class="loupe-cross">+</span><span class="loupe-coords mono"></span></div>' +
      '<div class="view-controls mono">' +
      `<div class="media-strip" role="radiogroup" aria-label="Views of ${esc(piece.name)}">${strip}</div>` +
      '<p class="visually-hidden" aria-live="polite" id="media-status"></p>' +
      '<button class="loupe-toggle" aria-pressed="false">Art detail +</button></div>'
    );
  }

  // Wire up the viewer in `stage` (the .piece-stage holding the garment and markup()) for `piece`.
  // motion: the prefers-reduced-motion media query (no wipes, no autoplaying loops).
  function mount({ stage, piece, motion }) {
    const media = mediaList(piece);
    const garment = stage.querySelector('.piece-garment');
    const teeView = stage.querySelector('.tee-view');
    const tee = stage.querySelector('.concept-tee');
    const artImg = tee.querySelector('.tee-art');
    const strip = [...stage.querySelectorAll('[data-media]')];
    const mediaFrame = stage.querySelector('.media-frame');
    const pauseButton = stage.querySelector('.media-pause');
    const mediaState = stage.querySelector('.media-state');
    const mediaStatus = stage.querySelector('#media-status');
    const loupe = stage.querySelector('.loupe');
    const loupeCoords = loupe.querySelector('.loupe-coords');
    const loupeToggle = stage.querySelector('.loupe-toggle');
    const mediaEls = new Map(); // item index → its built <picture> or <video>
    const preloaded = new Set();
    let current = -1;
    let surface = teeView; // the element showing the current view (the wipe runs on it)
    let userPaused = false;
    let stageVisible = true;
    let loupeOn = false;
    let lens = { x: 0.5, y: 0.5 }; // lens centre as fractions of the artwork
    let swipe = null;

    // ---------- Views ----------

    // Built on first view and kept, so a video keeps its place when you come back to it.
    function mediaElement(i) {
      if (mediaEls.has(i)) return mediaEls.get(i);
      const m = media[i];
      const tpl = document.createElement('template');
      if (m.type === 'image') {
        tpl.innerHTML =
          `<picture><source type="image/avif" srcset="${esc(mediaSrcset(m.src, 'avif'))}" sizes="${MEDIA_SIZES}">` +
          `<img class="media-image" src="${esc(mediaThumb(m.src, 640, 'jpg'))}" srcset="${esc(mediaSrcset(m.src, 'jpg'))}" ` +
          `sizes="${MEDIA_SIZES}" alt="${esc(m.alt)}" decoding="async"></picture>`;
      } else {
        const loop = m.mode === 'loop';
        const captions = m.captions
          ? `<track kind="captions" src="assets/${esc(m.captions)}" srclang="en" label="English" default>`
          : '';
        // preload="none": nothing but the poster loads until the video is shown.
        tpl.innerHTML =
          `<video class="media-video" playsinline preload="none" poster="${esc(mediaThumb(m.poster, 1280, 'jpg'))}" ` +
          `aria-label="${esc(m.alt)}"${loop ? ' muted loop' : ' controls'}>` +
          `<source src="assets/${esc(m.src)}" type="video/mp4">${captions}</video>`;
      }
      const el = tpl.content.firstElementChild;
      mediaEls.set(i, el);
      return el;
    }

    const activeVideo = () =>
      media[current] && media[current].type === 'video' ? mediaEls.get(current) : null;
    const isLoop = m => m && m.type === 'video' && m.mode === 'loop';

    function playLoop() {
      const video = activeVideo();
      if (
        video &&
        isLoop(media[current]) &&
        !userPaused &&
        !motion.matches &&
        !document.hidden &&
        stageVisible
      ) {
        video.play().catch(() => {});
      }
      syncPause();
    }

    function syncPause() {
      const video = activeVideo();
      pauseButton.hidden = !isLoop(media[current]);
      if (video) pauseButton.textContent = video.paused ? 'Play loop ▶' : 'Pause loop ‖';
    }

    function showMedia(i, { focus = false, announce = false } = {}) {
      if (i === current) return;
      const m = media[i];
      const old = activeVideo();
      if (old) old.pause();
      current = i;
      userPaused = false;
      strip.forEach((button, k) => {
        button.setAttribute('aria-checked', String(k === i));
        button.tabIndex = k === i ? 0 : -1;
      });
      if (focus) strip[i].focus();
      if (loupeOn) setLoupe(false);
      if (m.type === 'garment') {
        garment.classList.remove('media-hidden');
        mediaFrame.hidden = true;
        tee.classList.toggle('back', m.side === 'back');
        surface = teeView;
      } else {
        // The garment stays laid out (invisibly) so the radar keeps its centre.
        garment.classList.add('media-hidden');
        mediaFrame.hidden = false;
        mediaFrame.replaceChildren(mediaElement(i));
        surface = mediaFrame;
      }
      loupeToggle.disabled = !(m.type === 'image' || (m.type === 'garment' && m.side === 'front'));
      mediaState.textContent = `Media ${pad(i + 1)} / ${pad(media.length)} · ${m.label}`;
      if (announce) mediaStatus.textContent = `${m.label}, ${i + 1} of ${media.length}`;
      if (!motion.matches && stage.dataset.ready) {
        surface.classList.remove('wipe');
        void surface.offsetWidth; // restart the CSS animation
        surface.classList.add('wipe');
      }
      playLoop();
      preloadNext(i);
    }

    const step = by => (current + by + media.length) % media.length;

    // Fetch the next item's image (or poster) ahead of time, so moving on feels instant.
    function preloadNext(i) {
      const k = (i + 1) % media.length;
      const m = media[k];
      const src = stillOf(m);
      if (!src || preloaded.has(k)) return;
      preloaded.add(k);
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      if (m.type === 'image') {
        link.setAttribute('imagesrcset', mediaSrcset(src, 'avif'));
        link.setAttribute('imagesizes', MEDIA_SIZES);
        link.type = 'image/avif';
      } else {
        link.href = mediaThumb(src, 1280, 'jpg');
      }
      document.head.append(link);
    }

    strip.forEach((button, i) => {
      button.addEventListener('click', () => showMedia(i, { announce: true }));
      button.addEventListener('keydown', event => {
        const by = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        const target = by
          ? step(by)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? media.length - 1
              : null;
        if (target === null) return;
        event.preventDefault();
        showMedia(target, { focus: true, announce: true });
      });
    });
    for (const el of [teeView, mediaFrame])
      el.addEventListener('animationend', () => el.classList.remove('wipe'));

    // ---------- Video ----------

    pauseButton.addEventListener('click', () => {
      const video = activeVideo();
      if (!video) return;
      if (video.paused) {
        userPaused = false;
        video.play().catch(() => {});
      } else {
        userPaused = true;
        video.pause();
      }
      syncPause();
    });
    // Media events don't bubble; capture them from the frame.
    mediaFrame.addEventListener('play', syncPause, true);
    mediaFrame.addEventListener('pause', syncPause, true);
    // Video pauses when the stage scrolls away or the tab is hidden; a loop resumes when it comes back.
    new IntersectionObserver(([entry]) => {
      stageVisible = entry.isIntersecting;
      const video = activeVideo();
      if (!stageVisible && video) video.pause();
      else playLoop();
    }).observe(stage);
    document.addEventListener('visibilitychange', () => {
      const video = activeVideo();
      if (document.hidden && video) video.pause();
      else playLoop();
    });
    motion.addEventListener('change', () => {
      const video = activeVideo();
      if (motion.matches && video && media[current].mode === 'loop') video.pause();
      else playLoop();
    });

    // ---------- Art detail lens (garment front and photos) ----------

    const lensImage = () =>
      media[current].type === 'image' ? mediaEls.get(current).querySelector('img') : artImg;

    // Images are contained in their box, so measure the drawn image rather than the element.
    function artRect() {
      const img = lensImage();
      const box = img.getBoundingClientRect();
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      const scale = Math.min(box.width / nw, box.height / nh);
      const w = nw * scale;
      const h = nh * scale;
      return {
        left: box.left + (box.width - w) / 2,
        top: box.top + (box.height - h) / 2,
        width: w,
        height: h,
      };
    }

    function placeLoupe() {
      const art = artRect();
      const stageRect = stage.getBoundingClientRect();
      const zoom = media[current].type === 'image' ? LENS_ZOOM.image : LENS_ZOOM.garment;
      const size = loupe.offsetWidth;
      loupe.style.left = art.left + lens.x * art.width - stageRect.left + 'px';
      loupe.style.top = art.top + lens.y * art.height - stageRect.top + 'px';
      loupe.style.backgroundSize = art.width * zoom + 'px ' + art.height * zoom + 'px';
      loupe.style.backgroundPosition =
        size / 2 - lens.x * art.width * zoom + 'px ' + (size / 2 - lens.y * art.height * zoom) + 'px';
      loupeCoords.textContent = `X ${pad(Math.round(lens.x * 100), 3)} / Y ${pad(Math.round(lens.y * 100), 3)}`;
    }

    function setLoupe(on) {
      const target = surface === mediaFrame ? mediaFrame : garment;
      const photo = media[current].type === 'image';
      loupeOn = on;
      loupe.hidden = !on;
      for (const el of [garment, mediaFrame]) {
        el.classList.remove('inspecting');
        el.removeAttribute('tabindex');
        el.removeAttribute('aria-label');
      }
      loupeToggle.setAttribute('aria-pressed', String(on));
      loupeToggle.textContent = on ? 'Art detail −' : 'Art detail +';
      if (!on) return;
      // Full resolution is fetched only when the lens opens: the original artwork, or a photo's 1280px version.
      loupe.classList.toggle('photo', photo);
      const full = photo
        ? mediaThumb(media[current].src, 1280, 'jpg')
        : remoteArt(piece.image)
          ? cdnWidth(piece.image, 1600)
          : 'assets/' + piece.image;
      loupe.style.backgroundImage = `url("${full}")`;
      lens = { x: 0.5, y: 0.5 };
      target.classList.add('inspecting');
      target.tabIndex = 0;
      target.setAttribute('aria-label', 'Art detail lens. Use the arrow keys to move it, Escape to close.');
      placeLoupe();
    }

    // The lens follows a mouse, or a finger or pen while pressed.
    function follow(event) {
      if (!loupeOn || (event.pointerType !== 'mouse' && !event.buttons && event.type === 'pointermove'))
        return;
      const art = artRect();
      lens = {
        x: clamp((event.clientX - art.left) / art.width, 0, 1),
        y: clamp((event.clientY - art.top) / art.height, 0, 1),
      };
      placeLoupe();
    }

    // Arrow keys move the lens; Escape closes it.
    function nudge(event) {
      if (!loupeOn) return;
      if (event.key === 'Escape') {
        setLoupe(false);
        loupeToggle.focus();
        return;
      }
      const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!move) return;
      event.preventDefault();
      event.stopPropagation();
      lens = { x: clamp(lens.x + move[0] * LENS_STEP, 0, 1), y: clamp(lens.y + move[1] * LENS_STEP, 0, 1) };
      placeLoupe();
    }

    loupeToggle.addEventListener('click', () => setLoupe(!loupeOn));
    for (const el of [garment, mediaFrame]) {
      el.addEventListener('pointermove', follow);
      el.addEventListener('pointerdown', follow);
      el.addEventListener('keydown', nudge);
    }
    loupeToggle.addEventListener('keydown', nudge);
    addEventListener('resize', () => {
      if (loupeOn) placeLoupe();
    });

    showMedia(0);
    stage.dataset.ready = '1';

    // ---------- Swipes between views (touch and pen) ----------

    stage.addEventListener(
      'pointerdown',
      event => {
        if (event.pointerType !== 'mouse' && !loupeOn && !event.target.closest('video,button')) {
          swipe = { x: event.clientX, y: event.clientY };
        }
      },
      { passive: true },
    );
    stage.addEventListener('pointerup', event => {
      if (!swipe) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > SWIPE_MIN_X && Math.abs(dy) < SWIPE_MAX_Y && media.length > 1) {
        showMedia(step(dx < 0 ? 1 : -1), { announce: true });
      }
    });
    stage.addEventListener('pointercancel', () => {
      swipe = null;
    });
  }

  return { markup, mount };
})();
