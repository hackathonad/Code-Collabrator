# Deployment architecture

Code Collaborator has a static frontend and a persistent realtime backend.

```text
Browser
  ├── HTTPS ───────────────> Vercel: Vite/React frontend
  └── HTTPS + Socket.IO ───> Persistent Node.js: Express + Socket.IO backend
                                     ├── Supabase
                                     ├── Optional AI and GitHub services
                                     └── Optional LiveKit token service
```

Vercel hosts the frontend build and SPA rewrite only. It must not be the Socket.IO backend: collaboration needs a long-running process, WebSocket upgrades, and in-memory room runtime. The current server has no Socket.IO adapter or shared realtime-state layer, so start with one persistent backend instance.

## Frontend deployment: Vercel

Use `client/` as the Vercel project **Root Directory**. The committed [`client/vercel.json`](../client/vercel.json) specifies the SPA rewrite and these Vite settings:

| Setting | Value |
| --- | --- |
| Framework | Vite / React |
| Build command | `npm run build` |
| Output directory | `dist` |
| SPA rewrite | `/(.*)` → `/index.html` |

The repository-root [`vercel.json`](../vercel.json) also targets `client/package.json` for repository-root static builds. Neither Vercel configuration deploys the Node/Socket.IO backend.

Configure these Vercel **build-time** browser variables:

| Variable | When to set it | Browser-safe? |
| --- | --- | --- |
| `VITE_API_URL` | Required for production | Yes — public HTTPS backend origin |
| `VITE_SOCKET_URL` | Required for production | Yes — public HTTPS backend origin |
| `VITE_PUBLIC_SITE_URL` | Optional, recommended for canonical/Open Graph URLs | Yes |
| `VITE_SUPABASE_URL` | When browser Supabase authentication is enabled | Yes |
| `VITE_SUPABASE_ANON_KEY` | When browser Supabase authentication is enabled | Yes — anon/publishable key only |

Do not place backend secrets or any `SUPABASE_SERVICE_ROLE_KEY` value in Vercel frontend variables. The legacy `NEXT_PUBLIC_SUPABASE_*` names are supported for compatibility, but new deployments should use the `VITE_` names in the table.

## Backend deployment

Deploy the existing Node backend as a persistent Web Service, not a static site or a serverless function. The repository root (`.`) is the backend deployment root for the existing Dockerfile and npm-workspace commands; the backend source itself is in `server/`.

From the repository root, the production npm commands are:

```bash
npm ci
npm run build --workspace server
npm run start --workspace server
```

The existing [`Dockerfile`](../Dockerfile) performs the server build using Node 22 and starts `node server/dist/index.js`. It does not build or serve the Vite client.

### Backend environment and port behavior

Set `NODE_ENV=production`, `CLIENT_URL`, and `GUEST_SESSION_SECRET` before starting a production backend. The server refuses to start in production if the frontend-origin or guest-secret validation fails. Add only the optional integration variables that you use; see the complete [environment reference](ENVIRONMENT.md).

`PORT` is parsed as a positive valid port and defaults to `4000` when absent or invalid. The server calls `httpServer.listen(env.port)` and has no `HOST` environment variable or explicit host setting. Use a Web Service host that routes public traffic to its supplied `PORT`; do not add a host-binding variable that this repository does not read.

Set `CLIENT_URL` to the exact public frontend origin. It can contain a comma-separated list of origins. In production every origin must use HTTPS. The same allow-list is used by Express CORS and Socket.IO; credentials are disabled. Add a Vercel preview origin only when that preview is intentionally allowed to use the backend.

The backend exposes these unauthenticated operational endpoints:

| Endpoint | Meaning |
| --- | --- |
| `GET /health` | The backend process is alive. |
| `GET /ready` | Safe persistence and feature-availability status; it does not return secret values. |

The Socket.IO server accepts `websocket` and `polling` transports. The backend host must support HTTPS, WebSocket upgrades, and persistent connections. Point both frontend backend URLs at the same public HTTPS origin unless the services are intentionally separated.

## Render backend deployment

Deploy the backend on Render as a **Web Service**. Do not choose a Static Site.

| Render setting | Repository-derived value |
| --- | --- |
| Root directory | `.` (repository root) |
| Runtime | Docker, using the existing `Dockerfile` |
| Dockerfile | `Dockerfile` |
| Custom build command | None; the Dockerfile runs `npm ci` and `npm run build --workspace server` |
| Custom start command | None; the Dockerfile starts `node server/dist/index.js` |
| Required service type | Persistent Web Service with public HTTPS and WebSocket support |

Set the backend environment variables in Render, beginning with `NODE_ENV`, `CLIENT_URL`, and `GUEST_SESSION_SECRET`. Let Render provide `PORT` when it does; the server respects it. If `PORT` is not provided, the code falls back to `4000`.

After Render supplies the backend's public HTTPS origin, check:

```text
https://your-backend-origin/health
https://your-backend-origin/ready
```

Then configure the Vercel build variables and redeploy the frontend.

## Vercel → backend connection

After the persistent backend has a public HTTPS origin, configure exactly:

```text
VITE_API_URL = backend public HTTPS origin
VITE_SOCKET_URL = backend public HTTPS origin
```

Do not use a Vercel frontend URL for either variable. A Vercel frontend contains static files and cannot provide the Express API or durable Socket.IO connection required by rooms.

## Supabase

Apply these migrations in lexical order through the Supabase SQL editor or migration workflow:

1. `202608030001_auth_persistence.sql`
2. `202608050001_workspace.sql`
3. `202608180001_phase7_accounts_github.sql`
4. `202608180002_analytics.sql`

The migrations create account/persistence data, workspace snapshots, server-managed GitHub connection storage, and private analytics metadata. They enable row-level security; browser roles are revoked from the sensitive GitHub-connections and analytics tables.

In Supabase Auth, configure the frontend Site URL and allowed redirects for each deployed frontend. The client uses the frontend origin for Google OAuth and `/auth/callback` for password recovery. Include the local URLs used by this project as applicable:

```text
http://127.0.0.1:5173
http://127.0.0.1:5173/auth/callback
```

Also add the deployed frontend origin and its `/auth/callback` route. Preview deployments need matching allowed frontend redirects when authentication is tested there.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are browser-visible build values. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are separate backend values. Never expose `SUPABASE_SERVICE_ROLE_KEY` in Vercel, Vite, browser bundles, or client-side files.

## Optional integrations

- **Ollama:** The backend must be able to reach `OLLAMA_BASE_URL`. A Vercel browser cannot reach a developer laptop's local Ollama service.
- **Gemini and Groq:** Their API keys are server-only. Omit them to keep the provider unavailable without affecting rooms.
- **GitHub:** All four GitHub variables must be configured together. Set `GITHUB_REDIRECT_URI` to the backend callback ending in `/api/github/callback`.
- **LiveKit:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` must be configured together. Use a secure `wss:` endpoint for production media.

## Production checklist

1. Push the reviewed repository changes to GitHub.
2. Apply the four Supabase migrations in order and configure Supabase Auth Site URL/redirects.
3. Deploy one persistent backend Web Service.
4. Set the required backend variables: `NODE_ENV`, `CLIENT_URL`, and `GUEST_SESSION_SECRET`.
5. Test `GET /health` and `GET /ready` on the backend public HTTPS origin.
6. Create or update the Vercel frontend project using root directory `client/`.
7. Set `VITE_API_URL` and `VITE_SOCKET_URL`; set browser Supabase values only when authentication is enabled.
8. Redeploy the Vercel frontend after changing build-time variables.
9. Test sign-up, login, logout, callback handling, and a guest room where Supabase is configured.
10. Test room creation, a second participant, editor/chat synchronization, and a Socket.IO connection.
11. Smoke-test AI, GitHub, and LiveKit only when their complete optional configurations are present.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| **Failed to fetch** | Verify `VITE_API_URL` is the public backend HTTPS origin, the backend responds at `/health`, and the Vercel frontend was redeployed after the value changed. |
| **Backend unavailable** | Check the Web Service logs, `NODE_ENV=production`, required backend variables, the host-provided `PORT`, and `/health`. Production validation prevents startup when `CLIENT_URL` or `GUEST_SESSION_SECRET` is invalid. |
| **Socket.IO connection failure** | Verify `VITE_SOCKET_URL` targets the backend origin, the host supports WebSocket upgrades and persistent connections, and `CLIENT_URL` exactly includes the frontend origin. The server supports `websocket` and `polling`. |
| **CORS errors** | Set `CLIENT_URL` to the exact frontend origin, without an unexpected path. Use comma-separated origins only for intentionally permitted sites; production origins must be HTTPS. Redeploy/restart the backend after changing it. |
| **Supabase authentication redirect error** | Add both the frontend origin and its `/auth/callback` path to Supabase Auth redirects. Confirm the Vite Supabase URL and anon key are configured together, and do not use server credentials in the browser. |
| **Vercel SPA route returns 404** | Confirm the Vercel project uses `client/` and the committed `client/vercel.json`; its rewrite sends all routes to `index.html`. Redeploy after correcting the project root or build output. |
| **Render build or startup error** | Use a Render Web Service with root directory `.` and the existing `Dockerfile`. Do not override the Docker build/start commands. Check that the service is using the repository Docker context, receives `PORT`, and has the required backend environment variables. |
