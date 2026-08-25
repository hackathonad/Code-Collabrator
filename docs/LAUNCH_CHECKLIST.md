# Production launch checklist

1. Run `npm run verify` from the repository root.
2. If Supabase room persistence is enabled, apply `202608030001_auth_persistence.sql` and `202608050001_workspace.sql` in that order; apply later analytics/GitHub migrations only for those optional server features.
3. Deploy one persistent Node.js Web Service for the backend; do not deploy Socket.IO as a static site or serverless function.
4. Configure `NODE_ENV`, `CLIENT_URL`, and a unique production `GUEST_SESSION_SECRET`; add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only when persistence is desired.
5. Verify `/health` and `/ready` on the backend HTTPS origin.
6. Set Vercel build variables `VITE_API_URL`, `VITE_SOCKET_URL`, and optionally `VITE_PUBLIC_SITE_URL`.
7. Redeploy the frontend after changing build-time variables.
8. In a fresh browser, open `/`, choose a display name, create a room, edit, chat, open AI, and refresh.
9. Join the same room from a second browser; verify presence, cursors, typing, editor sync, bounded chat/history, and reconnect recovery.
10. Confirm the owner can delete the room, connected clients leave, the deleted room returns controlled 404 responses, and Quick Rejoin removes it.
11. Confirm a persistence outage leaves guest collaboration usable in memory and does not claim a durable save.
12. Confirm no service-role key, AI key, LiveKit secret, or guest-session secret appears in Vercel variables, tracked files, logs, or browser bundles.
