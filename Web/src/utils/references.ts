import type { Cell } from '../types/models';

/** Pattern for block references: @block-{shortId} or @block-{name} */
const REF_PATTERN = /@block-([a-zA-Z0-9]{3,})/gi;

/**
 * Extract reference identifiers from content
 * Returns lowercase identifiers (short IDs or names)
 */
export function extractReferenceIdentifiers(content: string): string[] {
  const text = stripHTML(content);
  const matches = text.matchAll(REF_PATTERN);
  return Array.from(matches, (m) => m[1].toLowerCase());
}

/**
 * Resolve reference identifiers to cell IDs
 */
export function resolveIdentifiers(
  identifiers: string[],
  cells: Map<string, Cell> | Cell[]
): string[] {
  const cellArray = cells instanceof Map ? Array.from(cells.values()) : cells;

  return identifiers
    .map((identifier) => {
      // First try to match by blockName
      const byName = cellArray.find(
        (c) => c.blockName?.toLowerCase() === identifier
      );
      if (byName) return byName.id;

      // Then try to match by ID prefix
      const byPrefix = cellArray.find((c) =>
        c.id.toLowerCase().startsWith(identifier)
      );
      if (byPrefix) return byPrefix.id;

      return null;
    })
    .filter((id): id is string => id !== null);
}

/**
 * Find a cell by short ID or block name
 */
export function findByShortIdOrName(
  cells: Map<string, Cell> | Cell[],
  ref: string
): Cell | undefined {
  const cellArray = cells instanceof Map ? Array.from(cells.values()) : cells;
  const lowerRef = ref.toLowerCase();

  // Try blockName first
  const byName = cellArray.find((c) => c.blockName?.toLowerCase() === lowerRef);
  if (byName) return byName;

  // Try ID prefix
  return cellArray.find((c) => c.id.toLowerCase().startsWith(lowerRef));
}

/**
 * Replace reference syntax with resolved content or formatted links
 */
export function resolveReferencesInContent(
  content: string,
  cells: Map<string, Cell> | Cell[],
  mode: 'display' | 'inject' = 'display'
): string {
  return content.replace(REF_PATTERN, (match, ref) => {
    const cell = findByShortIdOrName(cells, ref);
    if (!cell) return match; // Keep original if not found

    if (mode === 'inject') {
      // Inject the actual content (for AI processing)
      return stripHTML(cell.content);
    } else {
      // Display mode: format as a visual reference
      const label = cell.blockName || ref;
      return `[${label}]`;
    }
  });
}

/**
 * Get the short ID for a cell (first 4 chars of UUID)
 */
export function getShortId(cellId: string): string {
  return cellId.substring(0, 4).toLowerCase();
}

/**
 * Generate a reference string for a cell
 */
export function generateReference(cell: Cell): string {
  if (cell.blockName) {
    return `@block-${cell.blockName}`;
  }
  return `@block-${getShortId(cell.id)}`;
}

/**
 * Check if content contains any block references
 */
export function hasReferences(content: string): boolean {
  return REF_PATTERN.test(content);
}

/**
 * Strip HTML tags from content
 */
function stripHTML(html: string): string {
  // Use DOM parser if available
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  }
  // Fallback: regex strip
  return html.replace(/<[^>]+>/g, '');
}
