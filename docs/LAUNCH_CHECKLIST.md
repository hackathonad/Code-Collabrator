# Production launch checklist

Use this checklist after reviewing [deployment architecture](DEPLOYMENT.md) and the [environment reference](ENVIRONMENT.md).

1. Push the intended revision to GitHub.
2. Run `npm run verify` from the repository root.
3. Apply these Supabase migrations in order: `202608030001_auth_persistence.sql`, `202608050001_workspace.sql`, `202608180001_phase7_accounts_github.sql`, and `202608180002_analytics.sql`.
4. Configure the Supabase Auth Site URL and the deployed frontend origin plus `/auth/callback` as allowed redirects. Include local URLs only when they are needed.
5. Deploy one persistent Node.js Web Service for the backend. Do not deploy the backend as a Vercel static site or serverless handler.
6. Configure backend `NODE_ENV`, `CLIENT_URL`, and `GUEST_SESSION_SECRET`; add optional integration variables only as complete documented groups.
7. Verify the backend public HTTPS origin returns success from `/health` and `/ready`.
8. Configure the Vercel frontend project with root directory `client/`, build command `npm run build`, and output directory `dist`.
9. Set `VITE_API_URL` and `VITE_SOCKET_URL` to the backend public HTTPS origin. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only when browser authentication is enabled.
10. Redeploy the Vercel frontend after setting build-time variables.
11. Test authentication as configured: registration/sign-in, callback handling, refresh, logout, and a guest room.
12. Create a room in one browser and join it from a second browser or incognito window. Verify editor changes, cursors, files, chat, typing, reconnect behavior, and a Socket.IO connection.
13. If configured, smoke-test AI, GitHub OAuth, LiveKit media, and the analytics dashboard independently. Their absence must not prevent room editing or chat.
14. Confirm no service-role keys, OAuth secrets, AI keys, LiveKit secrets, guest-session secrets, or other credentials are present in Vercel `VITE_*` values, tracked files, CI logs, or browser bundles. Rotate any credential that was exposed.
