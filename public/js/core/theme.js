/**
 * @fileoverview Light and dark themes. The inline script in each page's
 * <head> applies the saved theme before first paint; this file wires up the
 * toggle and keeps the canvas colour scale in step.
 *
 * Canvas marks use tones measured from the page colour, so one scale serves
 * both themes: tones[0] is the page colour and tones[255] the strongest
 * contrast against it. Canvases repaint on the 'radar:theme' event.
 */

/* exported tones, echoInk */
/* global STORAGE_KEYS, localStore */

/** @type {!Array<string>} 256 CSS colours, from the page colour outwards. */
let tones = [];
/** @type {string} RGB triplet for fading echo marks, e.g. '150,150,150'. */
let echoInk = '';

(() => {
  const root = document.documentElement;

  /**
   * Applies a theme to the page, the canvas tones and the toggle buttons.
   * @param {string} theme 'light' or 'dark'.
   */
  function applyTheme(theme) {
    const light = theme === 'light';
    const paper = light ? [243, 242, 238] : [0, 0, 0];
    const step = light ? -1 : 1;
    root.dataset.theme = theme;
    tones = Array.from({ length: 256 }, (_, offset) => {
      const channels = paper.map(channel =>
        Math.max(0, channel + step * offset),
      );
      return `rgb(${channels.join(',')})`;
    });
    echoInk = light ? '93,92,88' : '150,150,150';
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.textContent = light ? 'DARK' : 'LIGHT';
      button.setAttribute(
        'aria-label',
        `Switch to ${light ? 'dark' : 'light'} mode`,
      );
    });
  }

  applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
  document.querySelectorAll('.theme-toggle').forEach(button =>
    button.addEventListener('click', () => {
      const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
      localStore.set(STORAGE_KEYS.theme, theme);
      applyTheme(theme);
      document.dispatchEvent(new Event('radar:theme'));
    }),
  );
})();
