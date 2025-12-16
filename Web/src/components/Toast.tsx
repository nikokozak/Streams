import { useToastStore, Toast as ToastType, ToastType as ToastVariant } from '../store/toastStore';

const icons: Record<ToastVariant, string> = {
  success: '✓',
  error: '✕',
  info: 'i',
  warning: '!',
};

interface ToastItemProps {
  toast: ToastType;
  onDismiss: () => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  return (
    <div className={`toast toast-${toast.type}`} role="alert">
      <div className="toast-icon">{icons[toast.type]}</div>
      <div className="toast-content">
        <span className="toast-message">{toast.message}</span>
        {toast.action && (
          <button className="toast-action" onClick={toast.action.onClick}>
            {toast.action.label}
          </button>
        )}
      </div>
      <button className="toast-dismiss" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}
