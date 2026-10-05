/**
 * @fileoverview Typed DOM lookups shared by every page.
 *
 * querySelector() returns null when nothing matches, and its result is typed
 * as a plain Element. element() is for elements the page's own markup always
 * contains: it returns an HTMLElement and fails at once, with the selector,
 * if the markup is missing one. Where an element may legitimately be absent,
 * use querySelector() and handle null.
 */

/* exported element, elements, targetElement, closestTarget */

const { element, elements, targetElement, closestTarget } = (() => {
  /**
   * The first element matching selector inside root.
   * @param {!ParentNode} root
   * @param {string} selector
   * @return {!HTMLElement}
   * @throws {Error} If nothing matches.
   */
  function element(root, selector) {
    const found = root.querySelector(selector);
    if (!found) throw new Error(`Missing element: ${selector}`);
    return /** @type {!HTMLElement} */ (found);
  }

  /**
   * Every element matching selector inside root, as an array.
   * @param {!ParentNode} root
   * @param {string} selector
   * @return {!Array<!HTMLElement>}
   */
  function elements(root, selector) {
    return [...root.querySelectorAll(selector)].map(
      found => /** @type {!HTMLElement} */ (found),
    );
  }

  /**
   * The element an event happened on. The site listens only on elements, so
   * the target is always one.
   * @param {!Event} event
   * @return {!HTMLElement}
   */
  function targetElement(event) {
    return /** @type {!HTMLElement} */ (event.target);
  }

  /**
   * The event's target or its nearest ancestor matching selector, if any:
   * how a listener on a container finds the control that was used.
   * @param {!Event} event
   * @param {string} selector
   * @return {?HTMLElement}
   */
  function closestTarget(event, selector) {
    return /** @type {?HTMLElement} */ (targetElement(event).closest(selector));
  }

  return { element, elements, targetElement, closestTarget };
})();
