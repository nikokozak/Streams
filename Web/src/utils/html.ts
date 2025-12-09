/**
 * HTML utility functions for content manipulation
 */

/**
 * Strip HTML tags to get plain text
 */
export function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

/**
 * Extract image HTML from content
 * @returns Array of <img> tag HTML strings
 */
export function extractImages(html: string): string[] {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const images = tmp.querySelectorAll('img');
  return Array.from(images).map(img => img.outerHTML);
}

/**
 * Build HTML block containing images (for prepending to AI responses)
 */
export function buildImageBlock(images: string[]): string {
  if (images.length === 0) return '';
  return `<div class="cell-images-block">${images.join('')}</div>`;
}

/**
 * Check if cell content is empty (for filtering spacing cells from context)
 * Note: cells with only images are NOT considered empty
 */
export function isEmptyCell(content: string): boolean {
  // Check for images first - a cell with images is not empty
  if (content.includes('<img')) return false;
  return stripHtml(content).trim().length === 0;
}
