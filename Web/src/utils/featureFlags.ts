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
 * Default: true (use unified editor)
 */
export function isUnifiedEditorEnabled(): boolean {
  const urlOverride = getUrlParam('unified');
  if (urlOverride !== null) {
    return urlOverride === 'true';
  }

  // Local override: allow explicit opt-out.
  // - 'false' => force legacy editor
  // - 'true'  => force unified editor
  // - null/anything else => default ON
  const local = getLocalStorage('USE_UNIFIED_EDITOR');
  if (local === 'false') return false;
  if (local === 'true') return true;
  return true;
}

export function setUnifiedEditorEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('USE_UNIFIED_EDITOR', enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

// Back-compat for existing imports. Prefer isUnifiedEditorEnabled().
export const USE_UNIFIED_EDITOR: boolean = isUnifiedEditorEnabled();
