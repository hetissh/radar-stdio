/**
 * @fileoverview The product page's size picker and add-to-bag button. Sizes
 * are a radio group drawn as concentric radar rings (XS innermost); choosing
 * one enables "Add to bag", which adds the piece to the concept bag.
 */

/* exported productSizes */
/* global esc, clamp, radar, bag */

const productSizes = (() => {
  // [size, chest in cm]. The readings are illustrative.
  const SIZES = [
    ['XS', 96],
    ['S', 102],
    ['M', 108],
    ['L', 114],
    ['XL', 120],
  ];
  // M takes focus first when tabbing into the rings.
  const FIRST_TAB_STOP = 2;
  // How long "Added" shows before the button offers "Add another", in ms.
  const ADDED_MS = 1600;

  /**
   * @param {string} label
   * @param {string} mark
   * @return {string} The add button's contents.
   */
  function buttonContent(label, mark) {
    return `<span>${label}</span><span aria-hidden="true">${mark}</span>`;
  }

  /** @return {string} HTML for the size rings, add button and status. */
  function markup() {
    const rings = SIZES.map(([size, chest], i) => {
      const diameter = 40 + i * 36; // pixels
      return (
        '<button class="size-ring" role="radio" aria-checked="false" ' +
        `tabindex="${i === FIRST_TAB_STOP ? 0 : -1}" data-size="${esc(size)}" ` +
        `data-chest="${chest}" ` +
        `aria-label="${esc(size)}, ${chest} centimetre chest" ` +
        `style="--d:${diameter}px;--layer:${10 - i}">` +
        `${radar.ringSvg(diameter)}<span class="size-label">${esc(size)}</span>` +
        '</button>'
      );
    }).join('');
    return (
      '<div class="size-field"><div class="size-head mono">' +
      '<span id="size-label">Size</span>' +
      '<span class="size-value">Choose a ring</span></div>' +
      '<div class="size-rings" role="radiogroup" aria-labelledby="size-label">' +
      `${rings}<span class="center-dot" aria-hidden="true">+</span></div>` +
      '<p class="size-note mono muted">' +
      'Relaxed shape · chest readings are illustrative</p></div>' +
      '<div class="piece-add-row"><button class="piece-add" disabled>' +
      `${buttonContent('Select a size', '↗')}</button></div>` +
      '<p class="visually-hidden" aria-live="polite" id="bag-status"></p>'
    );
  }

  /**
   * Wires up the picker.
   * @param {{root: !Element, piece: !Piece}} options root contains markup().
   */
  function mount({ root, piece }) {
    const rings = [...root.querySelectorAll('.size-ring')];
    const sizeValue = root.querySelector('.size-value');
    const add = root.querySelector('.piece-add');
    const status = root.querySelector('#bag-status');
    let chosen = '';
    let addedTimer = 0;

    /**
     * Chooses a size.
     * @param {!HTMLElement} ring
     */
    function choose(ring) {
      chosen = ring.dataset.size;
      for (const other of rings) {
        const on = other === ring;
        other.setAttribute('aria-checked', String(on));
        other.tabIndex = on ? 0 : -1;
      }
      sizeValue.textContent = `${chosen} / ${ring.dataset.chest} cm chest`;
      add.disabled = false;
      clearTimeout(addedTimer);
      add.innerHTML = buttonContent(`Add to bag / ${chosen}`, '↗');
    }

    /**
     * Radio-group keys: arrows step between sizes (up and right go larger),
     * Home and End jump to the ends.
     * @param {!KeyboardEvent} event
     * @param {number} index The ring the key was pressed on.
     */
    function onRingKey(event, index) {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[
        event.key
      ];
      const last = rings.length - 1;
      let target = null;
      if (step) {
        target = rings[clamp(index + step, 0, last)];
      } else if (event.key === 'Home') {
        target = rings[0];
      } else if (event.key === 'End') {
        target = rings[last];
      }
      if (!target) return;
      event.preventDefault();
      choose(target);
      target.focus();
    }

    /** Adds the piece in the chosen size, and pings the header's bag. */
    function addToBag() {
      if (!chosen) return;
      bag.add(piece, chosen);
      status.textContent = `${piece.name}, size ${chosen}, added to the concept bag.`;
      add.innerHTML = buttonContent(`Added / ${chosen}`, '✓');
      document.querySelectorAll('.bag-open').forEach(button => {
        button.classList.remove('pinged');
        void button.offsetWidth; // restart the CSS animation
        button.classList.add('pinged');
      });
      clearTimeout(addedTimer);
      addedTimer = setTimeout(() => {
        add.innerHTML = buttonContent(`Add another / ${chosen}`, '↗');
      }, ADDED_MS);
    }

    rings.forEach((ring, index) => {
      ring.addEventListener('click', () => choose(ring));
      ring.addEventListener('keydown', event => onRingKey(event, index));
    });
    add.addEventListener('click', addToBag);
    document
      .querySelectorAll('.bag-open')
      .forEach(button =>
        button.addEventListener('animationend', () =>
          button.classList.remove('pinged'),
        ),
      );
  }

  return { markup, mount };
})();
