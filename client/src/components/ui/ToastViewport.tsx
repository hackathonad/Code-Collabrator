import { CheckCircle2, X } from "lucide-react";
import type { ToastItem } from "../../hooks/useToast";

interface ToastViewportProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export const ToastViewport = ({ toasts, onDismiss }: ToastViewportProps) => (
  <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-3">
    {toasts.map((toast) => (
      <div
        key={toast.id}
        className="theme-toast pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl animate-[toast-slide_220ms_ease-out]"
      >
        <div className="rounded-full bg-emerald-400/10 p-1 text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
        </div>
        <p className="flex-1 text-sm font-medium leading-6 theme-text-primary">{toast.message}</p>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="theme-button-neutral rounded-full border border-transparent p-1 transition"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    ))}
  </div>
);
