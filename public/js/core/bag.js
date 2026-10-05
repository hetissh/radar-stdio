/**
 * @fileoverview The concept bag: pieces the visitor has added, kept across
 * pages and tabs in localStorage, and the dialog that lists them. Checkout is
 * not connected yet.
 */

/* exported bag */
/* global esc, pad, money, productUrl, productById */
/* global STORAGE_KEYS, localStore */

/**
 * One line in the bag. Each line keeps the name and price from when it was
 * added, like a real basket.
 * @typedef {Object} BagItem
 * @property {string} id The piece's id.
 * @property {string} size
 * @property {number} qty
 * @property {string=} name
 * @property {number=} price
 */

const bag = (() => {
  const dialog = document.querySelector('#bag');
  const list = dialog.querySelector('.bag-items');

  /**
   * Reads saved bag lines, dropping anything malformed.
   * @param {?string} json
   * @return {!Array<!BagItem>}
   */
  function parseBag(json) {
    try {
      return (JSON.parse(json) || []).filter(
        item => item && item.id && item.qty > 0,
      );
    } catch {
      // Unreadable saved data starts an empty bag.
      return [];
    }
  }

  const bag = {
    /** @type {!Array<!BagItem>} */
    items: parseBag(localStore.get(STORAGE_KEYS.bag)),

    /** Saves the bag and redraws it. */
    save() {
      localStore.set(STORAGE_KEYS.bag, JSON.stringify(this.items));
      render();
    },

    /**
     * Adds one of a piece in a size.
     * @param {!Piece} piece
     * @param {string} size
     */
    add(piece, size) {
      const item = this.items.find(
        line => line.id === piece.id && line.size === size,
      );
      if (item) {
        item.qty++;
      } else {
        this.items.push({
          id: piece.id,
          size,
          qty: 1,
          name: piece.name,
          price: piece.price,
        });
      }
      this.save();
    },

    /**
     * Changes a line's quantity, removing the line when it reaches zero.
     * @param {number} index
     * @param {number} step +1 or -1.
     */
    change(index, step) {
      const item = this.items[index];
      item.qty += step;
      if (item.qty < 1) this.items.splice(index, 1);
      this.save();
    },

    /** @return {number} Pieces in the bag, counting quantities. */
    count() {
      return this.items.reduce((total, item) => total + item.qty, 0);
    },

    /**
     * Gives lines saved before name and price were stored those details,
     * once the catalogue has loaded.
     */
    fill() {
      let changed = false;
      for (const item of this.items) {
        const piece = productById(item.id);
        if (piece && (!item.name || item.price === undefined)) {
          item.name = piece.name;
          item.price = piece.price;
          changed = true;
        }
      }
      if (changed) this.save();
    },
  };

  /**
   * @param {!BagItem} item
   * @param {number} index
   * @return {string} HTML for one line, with its quantity buttons.
   */
  function rowHtml(item, index) {
    const name = item.name || `Piece ${item.id}`;
    const label = `${esc(name)}, size ${esc(item.size)}`;
    const total = item.price === undefined ? '—' : money(item.price * item.qty);
    return (
      `<div class="bag-row"><a href="${productUrl(item)}">${esc(name)}</a>` +
      `<span class="mono bag-size">Size ${esc(item.size)}</span>` +
      '<span class="bag-qty">' +
      `<button data-bag="${index}" data-step="-1" ` +
      `aria-label="Remove one ${label}">−</button>` +
      `<span class="mono">${pad(item.qty)}</span>` +
      `<button data-bag="${index}" data-step="1" ` +
      `aria-label="Add one ${label}">+</button></span>` +
      `<span class="mono">${total}</span></div>`
    );
  }

  /** Redraws the header counts and the dialog's list. */
  function render() {
    const count = pad(bag.count());
    document.querySelectorAll('.bag-count').forEach(element => {
      element.textContent = count;
    });
    if (!bag.items.length) {
      list.innerHTML = '<p>Your concept bag is empty.</p>';
      return;
    }
    const total = bag.items.reduce(
      (sum, item) => sum + (item.price || 0) * item.qty,
      0,
    );
    const rows = bag.items.map(rowHtml).join('');
    list.innerHTML =
      `${rows}<div class="bag-total mono">` +
      `<span>Total / ${count} pieces</span><span>${money(total)}</span></div>`;
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-step]');
    if (!button) return;
    const index = Number(button.dataset.bag);
    const step = Number(button.dataset.step);
    bag.change(index, step);
    // Keep keyboard focus on the same control after the list re-renders.
    const same = dialog.querySelector(
      `[data-bag="${index}"][data-step="${step}"]`,
    );
    (same || dialog.querySelector('.bag-close')).focus();
  });
  document.querySelectorAll('.bag-open').forEach(button =>
    button.addEventListener('click', () => {
      render();
      dialog.showModal();
      document.body.classList.add('locked');
    }),
  );
  dialog
    .querySelector('.bag-close')
    .addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () =>
    document.body.classList.remove('locked'),
  );
  // Another tab changed the bag.
  addEventListener('storage', event => {
    if (event.key !== STORAGE_KEYS.bag) return;
    bag.items = parseBag(event.newValue);
    render();
  });
  render();

  return bag;
})();
