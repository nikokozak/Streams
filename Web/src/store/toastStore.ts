import { create } from 'zustand';

/**
 * Global toast store for transient UI notifications (errors, warnings, info).
 * This keeps toast state out of component trees and avoids prop-drilling.
 */
export type ToastKind = 'error' | 'warning' | 'info' | 'success';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, kind?: ToastKind, timeoutMs?: number) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const DEFAULT_TIMEOUT_MS = 6000;
/** Suppress duplicate toasts (same kind+message) within this window. */
const DEDUPE_MS = 2000;
/** Maximum number of toasts visible at once; oldest are dropped. */
const MAX_TOASTS = 4;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (message, kind = 'error', timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const { toasts } = get();

    // Dedupe: skip if the last toast has the same kind+message within the window.
    if (toasts.length > 0) {
      const last = toasts[toasts.length - 1];
      if (last.kind === kind && last.message === message) {
        if (Date.now() - last.createdAt < DEDUPE_MS) {
          return last.id; // Return existing toast ID, don't add duplicate
        }
      }
    }

    const id = crypto.randomUUID();
    const toast: Toast = {
      id,
      kind,
      message,
      createdAt: Date.now(),
    };

    set((state) => {
      let newToasts = [...state.toasts, toast];
      // Cap: drop oldest if exceeding max.
      if (newToasts.length > MAX_TOASTS) {
        newToasts = newToasts.slice(newToasts.length - MAX_TOASTS);
      }
      return { toasts: newToasts };
    });

    // Auto-dismiss by default to avoid stale toasts lingering.
    if (timeoutMs > 0) {
      window.setTimeout(() => {
        get().removeToast(id);
      }, timeoutMs);
    }

    return id;
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  clearToasts: () => set({ toasts: [] }),
}));
