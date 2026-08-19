import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

export const NetworkStatusBanner = () => {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);
  if (online) return null;
  return <div role="status" className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-amber-400 px-4 py-2 text-center text-xs font-semibold text-slate-950 shadow-lg"><WifiOff className="h-4 w-4" />You’re offline. Local edits may remain visible, but realtime collaboration requires a connection.</div>;
};
