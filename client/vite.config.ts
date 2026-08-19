import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  // This project was previously deployed with browser-safe Supabase values
  // named NEXT_PUBLIC_*. Keep VITE_* as the preferred convention while making
  // the current Vercel environment usable without duplicating credentials.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false
      },
      "/socket.io": {
        target: "ws://localhost:4000",
        ws: true,
        changeOrigin: true,
        secure: false
      }
    }
  }
});
