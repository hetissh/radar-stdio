/**
 * @fileoverview Navigation shared by every page: the header menu on small
 * screens, and page transitions that morph the clicked garment into the next
 * page's stage.
 */

(() => {
  const menu = document.querySelector('.menu-button');
  const nav = document.querySelector('.nav');

  /** @param {boolean} open */
  function setMenuOpen(open) {
    menu.setAttribute('aria-expanded', String(open));
    menu.textContent = open ? 'Close −' : 'Menu +';
    nav.classList.toggle('open', open);
  }

  menu.addEventListener('click', () =>
    setMenuOpen(menu.getAttribute('aria-expanded') !== 'true'),
  );
  nav
    .querySelectorAll('a, button')
    .forEach(link => link.addEventListener('click', () => setMenuOpen(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setMenuOpen(false);
  });

  // Name only the clicked garment, so it alone morphs into the next page's
  // stage.
  document.addEventListener('click', event => {
    const card = event.target.closest('.product-card');
    if (!card || event.defaultPrevented) return;
    document
      .querySelectorAll('.tee-view, .product-card .concept-tee')
      .forEach(element => {
        element.style.viewTransitionName = 'none';
      });
    const tee = card.querySelector('.concept-tee');
    if (tee) tee.style.viewTransitionName = 'piece';
  });
  // Coming back (including from the back/forward cache) clears the names for
  // the next navigation.
  addEventListener('pageshow', () =>
    document
      .querySelectorAll('.tee-view, .product-card .concept-tee, [data-morph]')
      .forEach(element => {
        element.style.viewTransitionName = '';
      }),
  );
  // A skipped page transition (hidden tab, rapid navigation) is harmless: its
  // rejected promises are deliberately ignored so they stay out of the error
  // console.
  for (const type of ['pageswap', 'pagereveal']) {
    addEventListener(type, event => {
      const transition = event.viewTransition;
      if (!transition) return;
      const promises = [
        transition.ready,
        transition.finished,
        transition.updateCallbackDone,
      ];
      for (const promise of promises) {
        promise?.catch(() => {});
      }
    });
  }
})();
