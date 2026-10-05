// Homepage collection locator: the small radar pinned to the corner while a collection is on screen. Its rings
// (one per collection, R01 innermost) show which collection you are in; choosing one scrolls to it, and hovering
// or focusing one previews its name.
//
// Classic script (see shared.js): defines the global `homeLocator`. Uses shared.js.
const homeLocator = (() => {
  const nameOf = i =>
    `${pad(i + 1)} / ${collectionData[i].title.toUpperCase()}`;

  // Wire up the locator.
  //   nav       the .mini-radar element (its ring buttons carry data-collection)
  //   footer    the page footer; the locator lifts so it never covers it
  //   sections  the collection <section> elements, by collection index
  //   motion    the prefers-reduced-motion media query (instant scrolling)
  // Returns update(active): call with the collection index in view, or -1 for none, whenever the page scrolls.
  /**
   *
   * @param root0
   * @param root0.nav
   * @param root0.footer
   * @param root0.sections
   * @param root0.motion
   */
  function mount({ nav, footer, sections, motion }) {
    const title = nav.querySelector('strong');
    const buttons = [...document.querySelectorAll('[data-collection]')];
    let active = -1;

    /**
     *
     * @param current
     */
    function update(current) {
      active = current;
      nav.classList.toggle('visible', current >= 0);
      nav.style.setProperty(
        '--lift',
        `${Math.max(0, innerHeight - footer.getBoundingClientRect().top)}px`,
      );
      nav.inert = current < 0;
      if (current < 0) return;
      title.textContent = nameOf(current);
      buttons.forEach(button => {
        button.setAttribute(
          'aria-current',
          String(Number(button.dataset.collection) === current),
        );
      });
    }

    buttons.forEach(button => {
      const i = Number(button.dataset.collection);
      button.addEventListener('click', () => {
        sections[i].scrollIntoView({
          behavior: motion.matches ? 'instant' : 'smooth',
          block: 'start',
        });
        history.replaceState(null, '', `#${collectionData[i].id}`);
      });
      const preview = () => {
        title.textContent = nameOf(i);
      };
      const restore = () => {
        if (active >= 0) title.textContent = nameOf(active);
      };
      button.addEventListener('pointerenter', preview);
      button.addEventListener('pointerleave', restore);
      button.addEventListener('focus', preview);
      button.addEventListener('blur', restore);
    });

    return { update };
  }

  return { mount };
})();
