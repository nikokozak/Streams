/**
 * Feature flags for controlled rollout of new functionality.
 *
 * To enable unified editor during development:
 * - Add ?unified=true to the URL, or
 * - Set localStorage.setItem('USE_UNIFIED_EDITOR', 'true')
 */

function getUrlParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function getLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Use the new unified stream editor (single TipTap instance for cross-cell selection).
 * Default: false (use legacy per-cell editors)
 */
export const USE_UNIFIED_EDITOR: boolean =
  getUrlParam('unified') === 'true' ||
  getLocalStorage('USE_UNIFIED_EDITOR') === 'true';
