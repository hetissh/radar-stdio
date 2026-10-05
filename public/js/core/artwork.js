/**
 * @fileoverview Artwork images for pieces.
 *
 * Supplied artwork uses thumbnails from scripts/build_images.py: AVIF where
 * the browser supports it, JPEG otherwise, 320 or 640 px wide by display
 * size; the originals stay in assets/. A piece created in the Shopify admin
 * has a cdn.shopify.com URL instead: the CDN resizes it by ?width= and picks
 * AVIF or WebP itself, so it needs no <source> (see scripts/sync_shopify.py).
 */

/* exported art, remoteArt, cdnWidth */
/* global esc */
/* global assetUrls -- defined only in the portable export */

const { art, remoteArt, cdnWidth } = (() => {
  /**
   * Whether an image lives on Shopify's CDN rather than in assets/.
   * @param {string} src
   * @return {boolean}
   */
  function remoteArt(src) {
    return /^https:\/\/cdn\.shopify\.com\//.test(src);
  }

  /**
   * A Shopify CDN image URL resized to a width.
   * @param {string} url
   * @param {number} width Pixels.
   * @return {string}
   */
  function cdnWidth(url, width) {
    const resized = new URL(url);
    resized.searchParams.set('width', width);
    return resized.href;
  }

  /**
   * The URL of a piece's artwork at a width.
   * @param {!Piece} piece
   * @param {number} width 320 or 640 for bundled thumbnails.
   * @param {string=} ext 'avif' or 'jpg'; ignored for CDN images.
   * @return {string}
   */
  function thumb(piece, width, ext) {
    if (remoteArt(piece.image)) return cdnWidth(piece.image, width);
    const name = piece.image.replace(/\.png$/, '');
    return `assets/thumbs/${name}-${width}.${ext}`;
  }

  /**
   * Markup for a piece's artwork: a <picture> with AVIF and JPEG, or an
   * <img> for CDN images and in the portable export.
   * @param {!Piece} piece
   * @param {{sizes: (string|undefined), className: (string|undefined),
   *     eager: (boolean|undefined)}=} options sizes is the CSS width hint;
   *     eager loads the image straight away (by default only piece 01's).
   * @return {string}
   */
  function art(piece, options = {}) {
    const {
      sizes = '160px',
      className = '',
      eager = piece.id === '01',
    } = options;
    const classAttr = className ? ` class="${className}"` : '';
    const attrs =
      ` alt="${esc(piece.title)}"${classAttr}` +
      ` loading="${eager ? 'eager' : 'lazy'}" decoding="async"`;
    // The portable export inlines one JPEG per image instead (see
    // scripts/export.py).
    if (typeof assetUrls !== 'undefined') {
      return `<img src="${assetUrls[piece.image]}"${attrs}>`;
    }
    const srcset = ext =>
      `${thumb(piece, 320, ext)} 320w, ${thumb(piece, 640, ext)} 640w`;
    if (remoteArt(piece.image)) {
      return (
        `<img src="${esc(thumb(piece, 320))}" srcset="${esc(srcset())}" ` +
        `sizes="${sizes}"${attrs}>`
      );
    }
    return (
      '<picture>' +
      `<source type="image/avif" srcset="${srcset('avif')}" sizes="${sizes}">` +
      `<img src="${thumb(piece, 320, 'jpg')}" srcset="${srcset('jpg')}" ` +
      `sizes="${sizes}"${attrs}></picture>`
    );
  }

  return { art, remoteArt, cdnWidth };
})();
