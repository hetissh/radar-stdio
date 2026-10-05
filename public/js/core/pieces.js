/**
 * @fileoverview Piece helpers shared by every page: links, prices, colour
 * names and the product card used on the homepage rails, the catalogue grid
 * and the product page's "More on this orbit" rail.
 */

/* exported productUrl, reduced, priceHtml, colourOf, productCard */
/* global esc, pad, money, art */

/**
 * @param {{id: string}} piece
 * @return {string} The piece's product page URL.
 */
function productUrl(piece) {
  return `product.html?id=${encodeURIComponent(piece.id)}`;
}

/**
 * Whether a piece is reduced: it carries an original price above its price.
 * @param {!Piece} piece
 * @return {boolean}
 */
function reduced(piece) {
  return piece.original > piece.price;
}

/**
 * A piece's price, with the original struck through when reduced.
 * @param {!Piece} piece
 * @return {string} HTML.
 */
function priceHtml(piece) {
  const original = reduced(piece) ? `<del>${money(piece.original)}</del>` : '';
  return original + money(piece.price);
}

/**
 * @param {!Piece} piece
 * @return {string} 'Washed black' or 'Chalk'.
 */
function colourOf(piece) {
  return piece.dark ? 'Washed black' : 'Chalk';
}

/**
 * A product card: the garment with its artwork, name, price and colour.
 * @param {!Piece} piece
 * @return {string} HTML for one <a class="product-card">.
 */
function productCard(piece) {
  return (
    `<a class="product-card" data-product="${piece.id}" ` +
    `href="${productUrl(piece)}" aria-label="View ${esc(piece.name)}">` +
    '<div class="garment-space">' +
    `<span class="signal-tag">${pad(piece.position + 1)} / SIGNAL</span>` +
    `<div class="concept-tee ${piece.dark ? 'dark' : ''}">${art(piece)}</div>` +
    '</div>' +
    `<div class="piece-caption"><span>${esc(piece.name)}</span>` +
    `<span class="mono">${priceHtml(piece)}</span></div>` +
    `<div class="piece-meta">${colourOf(piece).toUpperCase()} / ` +
    'RELAXED SHAPE</div></a>'
  );
}
