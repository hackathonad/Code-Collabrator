import { useCallback, useEffect, useState } from "react";

export interface ToastItem {
  id: number;
  message: string;
}

export const useToast = (duration = 3200) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, message }]);
    return id;
  }, []);

  useEffect(() => {
    if (!toasts.length) {
      return;
    }

    const timers = toasts.map((toast) => window.setTimeout(() => dismissToast(toast.id), duration));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dismissToast, duration, toasts]);

  return {
    toasts,
    pushToast,
    dismissToast
  };
};
