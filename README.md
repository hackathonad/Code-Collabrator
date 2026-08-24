# Code Collaborator

Code Collaborator is a full-stack realtime collaborative coding application. It uses a Vite/React client, an Express + Socket.IO server, Supabase-backed account and persistence features, and optional AI, GitHub, and LiveKit integrations.

**Live project:** [Open Code Collaborator](https://code-collabrator-client.vercel.app/) | [GitHub repository](https://github.com/hackathonad/Code-Collabrator)

## Architecture

```text
Browser
  ├─ HTTPS ──────────────> Vercel: Vite/React static frontend
  └─ HTTPS + Socket.IO ──> Persistent Node.js: Express + Socket.IO backend
                                  ├─ Supabase Auth and database
                                  ├─ Optional AI providers
                                  ├─ Optional GitHub OAuth
                                  └─ Optional LiveKit token service
```

Vercel serves the frontend build and rewrites SPA routes to `index.html`. It is not the persistent realtime server. Room collaboration uses a long-running Socket.IO process and server memory; the backend has no Socket.IO adapter for horizontal fan-out. Deploy one persistent backend instance with WebSocket support. See [deployment architecture](docs/DEPLOYMENT.md) for the production topology and provider setup.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind, Monaco Editor
- Backend: Node.js, Express, TypeScript, Socket.IO
- Accounts and persistence: Supabase
- Optional AI: Ollama, Gemini, Groq
- Optional media: LiveKit

## Project structure

```text
.
├── client/                 # Vite/React frontend
├── server/                 # Express + Socket.IO backend
├── supabase/migrations/    # SQL migrations, applied in lexical order
├── Dockerfile              # Existing backend container build
├── vercel.json             # Repository-root static frontend configuration
└── docs/
```

## Local development

This repository requires Node.js `>=22.0.0`.

Install workspace dependencies from the repository root:

```bash
npm install
```

Create local environment files from `client/.env.example` and `server/.env.example` when needed. The client development server proxies `/api` and `/socket.io` to `http://localhost:4000`; leave `VITE_API_URL` and `VITE_SOCKET_URL` empty for that local-proxy setup.

Run both applications together:

```bash
npm run dev
```

Or run them in separate terminals:

```bash
npm run dev --workspace server
npm run dev --workspace client
```

The backend defaults to port `4000`; Vite runs on `http://127.0.0.1:5173` and is intentionally bound to that address.

Build the whole workspace:

```bash
npm run build
```

Build either application:

```bash
npm run build --workspace server
npm run build --workspace client
```

Run the complete verification command:

```bash
npm run verify
```

Available test commands are:

```bash
npm run test
npm run test:auth-client
npm run test:media-client
npm run test --workspace server
npm run test:ai --workspace server
npm run test:collaboration --workspace server
npm run test:media --workspace server
```

## Features

- Create and join rooms with unique IDs
- Live shared editor state for JavaScript, Python, and C++
- Remote cursors, participant roles, chat, typing indicators, and workspace files
- Workspace-aware AI actions for explain, fix, refactor, test, document, review, and summary tasks
- Optional GitHub connected-account integration
- Optional LiveKit voice, video, screen sharing, and device controls
- Supabase-backed member accounts, persistence, and private analytics when configured

## Supabase and optional services

Guest collaboration works without Supabase. Enabling member authentication and server persistence requires separate browser-safe Supabase values for the Vite build and server-only Supabase values for the backend. Never expose `SUPABASE_SERVICE_ROLE_KEY` in the client or a `VITE_*` variable.

Apply the SQL files in `supabase/migrations/` in lexical order. The exact migration list, redirect requirements, and full environment reference are documented in [deployment architecture](docs/DEPLOYMENT.md) and [environment reference](docs/ENVIRONMENT.md).

Ollama runs on the backend machine or network, not in the browser. Gemini, Groq, GitHub, and LiveKit remain optional; leaving an integration unconfigured does not disable rooms, editing, or chat.

## Optional integrations and analytics

AI provider credentials remain server-only and are never sent over Socket.IO or returned by provider-status responses. If Ollama is not installed, cannot be reached, or has no models, the collaboration workspace remains available and the AI panel reports the provider state. Gemini and Groq are enabled only when their server credentials are configured.

GitHub is a connected-account integration, not an application sign-in method. Its backend callback is `/api/github/callback`; GitHub access tokens are encrypted before server-side persistence and are never sent to the browser, room metadata, or generic profile endpoint.

LiveKit is optional. Calls use short-lived backend-issued room tokens that are bound to the current participant. Camera, microphone, and screen capture require direct browser user actions. Production media requires HTTPS and a secure `wss:` LiveKit endpoint.

The private analytics dashboard requests `GET /api/analytics/me?range=7d|30d|90d|all`. The server records only allow-listed activity metadata for authenticated members, not source code, files, chat, AI prompts or responses, credentials, or media. Raw `analytics_events` retention is an external server-side operational task; it must never be applied to rooms, workspaces, project data, chat, or AI conversation history.

## Documentation

- [Production deployment architecture, Vercel, backend, and Render](docs/DEPLOYMENT.md)
- [Environment variable reference](docs/ENVIRONMENT.md)
- [Production launch checklist](docs/LAUNCH_CHECKLIST.md)
- [Realtime load-test plan](docs/LOAD_TESTING.md)
- [Security policy](SECURITY.md)

## Notes

- The backend stores live room state in memory between persisted snapshots. Run one realtime backend instance unless a future Socket.IO adapter and shared-state design are added.
- `/health` reports that the backend process is alive. `/ready` reports safe feature availability without returning secret values.
- Guest-session signatures are tied to `GUEST_SESSION_SECRET`; changing that server secret invalidates existing guest sessions.
- The analytics feature records only allow-listed product metadata for authenticated members. It excludes source code, file contents, chat, credentials, AI prompts/responses, and media data.
