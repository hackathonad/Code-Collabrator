# Deployment topology

Code Collaborator has two production deployment responsibilities:

```text
Browser ── HTTPS ──> Vercel static React/Vite frontend
   │
   └── HTTPS + WebSocket ──> one long-running Node/Express + Socket.IO backend
                                  ├── Supabase
                                  ├── optional GitHub / AI providers
                                  └── optional LiveKit token service
```

Vercel hosts the static frontend and SPA rewrite only. It must not be used as the durable Socket.IO server. A normal Node host or the supplied Docker image is required, with WebSocket support and HTTPS terminated at the platform or reverse proxy. Start with **one realtime backend instance**: room state is held in memory between persisted snapshots and no Socket.IO adapter is configured for horizontal fan-out.

## Backend

1. Apply Supabase migrations in lexical order from `supabase/migrations/`; do not edit previously applied migrations.
2. Set `NODE_ENV=production`, `CLIENT_URL`, and a unique `GUEST_SESSION_SECRET` (32+ characters). The server fails startup if these core production requirements are absent.
3. Add only the optional service variables you use. Partial LiveKit/GitHub configuration is reported as a startup warning and leaves that feature unavailable.
4. Run `npm run build && npm run start`, or build with `docker build -t code-collaborator-backend .` and run with injected environment variables.
5. Verify `GET /health` (process alive) and `GET /ready` (safe feature availability). Neither endpoint exposes secrets.

## Frontend / Vercel

Set the Vercel project root directory to `client/`. The committed `client/vercel.json` runs the Vite build and rewrites SPA routes to `index.html`. Set these build-time browser variables:

```env
VITE_API_URL=https://api.example.com
VITE_SOCKET_URL=https://api.example.com
VITE_PUBLIC_SITE_URL=https://app.example.com
VITE_SUPABASE_URL=https://project.supabase.co
VITE_SUPABASE_ANON_KEY=public-anon-or-publishable-key
```

Set `CLIENT_URL=https://app.example.com` on the backend (include preview/local origins as comma-separated values only when needed). Use `wss://` for LiveKit behind HTTPS. Preview deployments should use a preview frontend origin and matching Supabase/GitHub redirect URLs; never point untrusted previews at production OAuth credentials.

## Supabase checklist

- Apply `202608030001_auth_persistence.sql`, `202608050001_workspace.sql`, `202608180001_phase7_accounts_github.sql`, then `202608180002_analytics.sql`.
- Confirm RLS remains enabled, including browser revocation on `github_connections` and `analytics_events`.
- Configure the Auth site URL plus `/auth/callback` redirect URLs for local and production. Email-confirmation and password recovery return through this route.
- Configure raw `analytics_events` retention (90 days) with a server-only scheduler if analytics is enabled. Analytics failures are intentionally non-critical.

## Optional integrations

- GitHub OAuth callback: `https://api.example.com/api/github/callback`. Keep its client secret and token encryption key server-only.
- Ollama is local to the backend machine/network; a public Vercel site cannot reach a developer's laptop Ollama service.
- LiveKit must be separately configured. Without its three server variables, editing, chat, and workspaces remain usable.
- Current execution opens external runners. In-app sandbox execution/Judge0 is intentionally not part of this release.
