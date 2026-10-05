/**
 * @fileoverview Homepage: the entrance radar (home-entrance.js), then one
 * section per collection with its rail of pieces (home-collections.js, with
 * its canvas in home-arcs.js), and a corner locator showing which collection
 * is in view (home-locator.js).
 */

/* global collectionData, radarData, radarPerf, showLoadError */
/* global homeEntrance, homeLocator, homeCollections */

(async () => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  // The collections need catalogue data (data/home.json: collection counts
  // and featured pieces); the entrance radar starts straight away.
  const loading = radarData.home();
  homeEntrance.mount({
    section: document.querySelector('.entrance'),
    canvas: document.querySelector('.radar-scan'),
    motion,
  });

  const list = document.querySelector('#collection-list');
  try {
    await loading;
    const homeStart = performance.now();
    const total = collectionData.reduce(
      (sum, collection) => sum + collection.count,
      0,
    );
    document.querySelector('.view-all').textContent = `View all ${total} ↗`;
    list.innerHTML = homeCollections.markup();
    const sections = [...list.querySelectorAll('.collection')];
    const locator = homeLocator.mount({
      nav: document.querySelector('.mini-radar'),
      footer: document.querySelector('.field-footer'),
      sections,
      motion,
    });
    homeCollections.mount({ sections, motion, onSync: locator.update });
    radarPerf?.record('homepage build', performance.now() - homeStart);
  } catch (error) {
    console.error(error);
    showLoadError(list, 'the collections');
  }
})();
