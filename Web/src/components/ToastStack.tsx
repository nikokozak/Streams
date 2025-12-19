import { useToastStore } from '../store/toastStore';

/**
 * Bottom-right toast stack for transient notifications.
 * Renders globally so errors are visible across all views.
 */
export function ToastStack() {
  // IMPORTANT:
  // Select individual fields rather than returning a new object from the selector.
  // Returning a new object each time makes the snapshot unstable and can trigger
  // React's `useSyncExternalStore` "getSnapshot should be cached" warning / loops.
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  if (toasts.length === 0) return null;

  // aria-live lets assistive tech announce new toasts without stealing focus.
  return (
    <div
      className="toast-stack"
      aria-live="polite"
      aria-relevant="additions removals"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          data-kind={toast.kind}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <div className="toast-message">{toast.message}</div>
          <button
            className="toast-dismiss"
            type="button"
            onClick={() => removeToast(toast.id)}
            aria-label="Dismiss notification"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
