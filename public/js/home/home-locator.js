/**
 * @fileoverview The homepage collection locator: a small radar pinned to the
 * corner while a collection is on screen. Its rings (one per collection, R01
 * innermost) show which collection is in view; choosing one scrolls to it,
 * and hovering or focusing one previews its name.
 */

/* exported homeLocator */
/* global pad, element, elements, collectionData */

const homeLocator = (() => {
  /**
   * @param {number} index Collection index.
   * @return {string} For example '02 / BEST SELLERS'.
   */
  function nameOf(index) {
    return `${pad(index + 1)} / ${collectionData[index].title.toUpperCase()}`;
  }

  /**
   * Wires up the locator.
   * @param {{
   *   nav: !HTMLElement,
   *   footer: !Element,
   *   sections: !Array<!HTMLElement>,
   *   motion: !MediaQueryList,
   * }} options nav is the .mini-radar (its ring buttons carry
   *     data-collection); the locator lifts so it never covers the footer;
   *     sections by collection index; motion is the prefers-reduced-motion
   *     query (instant scrolling).
   * @return {{update: function(number): void}} Call update() on every scroll with
   *     the collection in view, or -1 for none.
   */
  function mount({ nav, footer, sections, motion }) {
    const title = element(nav, 'strong');
    const buttons = elements(document, '[data-collection]');
    let active = -1;

    /** @param {number} current */
    function update(current) {
      active = current;
      nav.classList.toggle('visible', current >= 0);
      const lift = Math.max(
        0,
        innerHeight - footer.getBoundingClientRect().top,
      );
      nav.style.setProperty('--lift', `${lift}px`);
      nav.inert = current < 0;
      if (current < 0) return;
      title.textContent = nameOf(current);
      for (const button of buttons) {
        const isCurrent = Number(button.dataset.collection) === current;
        button.setAttribute('aria-current', String(isCurrent));
      }
    }

    for (const button of buttons) {
      const index = Number(button.dataset.collection);
      button.addEventListener('click', () => {
        sections[index].scrollIntoView({
          behavior: motion.matches ? 'instant' : 'smooth',
          block: 'start',
        });
        history.replaceState(null, '', `#${collectionData[index].id}`);
      });
      const preview = () => {
        title.textContent = nameOf(index);
      };
      const restore = () => {
        if (active >= 0) title.textContent = nameOf(active);
      };
      button.addEventListener('pointerenter', preview);
      button.addEventListener('pointerleave', restore);
      button.addEventListener('focus', preview);
      button.addEventListener('blur', restore);
    }

    return { update };
  }

  return { mount };
})();
