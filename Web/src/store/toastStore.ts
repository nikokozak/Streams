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

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (message, kind = 'error', timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const id = crypto.randomUUID();
    const toast: Toast = {
      id,
      kind,
      message,
      createdAt: Date.now(),
    };

    set((state) => ({ toasts: [...state.toasts, toast] }));

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
