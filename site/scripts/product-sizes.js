// Product page size picker and add-to-bag: sizes are a radio group drawn as concentric radar rings
// (XS innermost); choosing one enables "Add to bag", which adds the piece to the concept bag (shared.js).
//
// Classic script (see shared.js): defines the global `productSizes`. Uses shared.js and radar.js.
const productSizes = (() => {
  // [size, chest in cm]. The readings are illustrative.
  const SIZES = [
    ['XS', 96],
    ['S', 102],
    ['M', 108],
    ['L', 114],
    ['XL', 120],
  ];
  const FIRST_TAB_STOP = 2; // M takes focus first when tabbing into the rings
  const ADDED_MS = 1600; // how long "Added" shows before the button offers "Add another"

  const buttonContent = (label, mark) => `<span>${label}</span><span aria-hidden="true">${mark}</span>`;

  function markup() {
    const rings = SIZES.map(([size, chest], i) => {
      const d = 40 + i * 36; // ring diameter in px
      return (
        `<button class="size-ring" role="radio" aria-checked="false" tabindex="${i === FIRST_TAB_STOP ? 0 : -1}" ` +
        `data-size="${esc(size)}" data-chest="${chest}" aria-label="${esc(size)}, ${chest} centimetre chest" ` +
        `style="--d:${d}px;--layer:${10 - i}">${radar.ringSvg(d)}<span class="size-label">${esc(size)}</span></button>`
      );
    }).join('');
    return (
      '<div class="size-field">' +
      '<div class="size-head mono"><span id="size-label">Size</span><span class="size-value">Choose a ring</span></div>' +
      `<div class="size-rings" role="radiogroup" aria-labelledby="size-label">${rings}` +
      '<span class="center-dot" aria-hidden="true">+</span></div>' +
      '<p class="size-note mono muted">Relaxed shape · chest readings are illustrative</p></div>' +
      `<div class="piece-add-row"><button class="piece-add" disabled>${buttonContent('Select a size', '↗')}</button></div>` +
      '<p class="visually-hidden" aria-live="polite" id="bag-status"></p>'
    );
  }

  // Wire up the picker inside `root` (the element containing markup()) for `piece`.
  function mount({ root, piece }) {
    const ringButtons = [...root.querySelectorAll('.size-ring')];
    const sizeValue = root.querySelector('.size-value');
    const add = root.querySelector('.piece-add');
    const status = root.querySelector('#bag-status');
    let chosen = '';
    let addedTimer = 0;

    function choose(button, focus) {
      chosen = button.dataset.size;
      ringButtons.forEach(b => {
        const on = b === button;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      if (focus) button.focus();
      sizeValue.textContent = `${chosen} / ${button.dataset.chest} cm chest`;
      add.disabled = false;
      clearTimeout(addedTimer);
      add.innerHTML = buttonContent('Add to bag / ' + chosen, '↗');
    }

    // Radio-group keys: arrows step between sizes (up and right go larger), Home and End jump to the ends.
    ringButtons.forEach((button, i) => {
      button.addEventListener('click', () => choose(button, false));
      button.addEventListener('keydown', event => {
        const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
        const last = ringButtons.length - 1;
        const target = step
          ? ringButtons[clamp(i + step, 0, last)]
          : event.key === 'Home'
            ? ringButtons[0]
            : event.key === 'End'
              ? ringButtons[last]
              : null;
        if (target) {
          event.preventDefault();
          choose(target, true);
        }
      });
    });

    add.addEventListener('click', () => {
      if (!chosen) return;
      bag.add(piece, chosen);
      status.textContent = `${piece.name}, size ${chosen}, added to the concept bag.`;
      add.innerHTML = buttonContent('Added / ' + chosen, '✓');
      // Ping the header's bag button.
      document.querySelectorAll('.bag-open').forEach(b => {
        b.classList.remove('pinged');
        void b.offsetWidth; // restart the CSS animation
        b.classList.add('pinged');
      });
      clearTimeout(addedTimer);
      addedTimer = setTimeout(() => {
        add.innerHTML = buttonContent('Add another / ' + chosen, '↗');
      }, ADDED_MS);
    });
    document
      .querySelectorAll('.bag-open')
      .forEach(b => b.addEventListener('animationend', () => b.classList.remove('pinged')));
  }

  return { markup, mount };
})();
