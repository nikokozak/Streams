import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${++toastId}`;
    const duration = toast.duration ?? (toast.type === 'error' ? 6000 : 4000);

    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));

    // Auto-dismiss after duration
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }

    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearAll: () => {
    set({ toasts: [] });
  },
}));

// Convenience functions for easy toast creation
export const toast = {
  success: (message: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'message'>>) =>
    useToastStore.getState().addToast({ type: 'success', message, ...options }),

  error: (message: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'message'>>) =>
    useToastStore.getState().addToast({ type: 'error', message, ...options }),

  info: (message: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'message'>>) =>
    useToastStore.getState().addToast({ type: 'info', message, ...options }),

  warning: (message: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'message'>>) =>
    useToastStore.getState().addToast({ type: 'warning', message, ...options }),
};
