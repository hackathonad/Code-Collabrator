# Code Collaborator

Code Collaborator is a modern full-stack realtime collaborative coding platform built with React, Tailwind, Monaco Editor, Express, and Socket.IO. It supports multiplayer rooms, multi-file workspaces, live code sync, remote cursors, chat, role-aware collaboration, optional AI assistance, GitHub connection foundations, and optional voice/video.

## Stack

- Frontend: React + TypeScript + Vite + Tailwind + Monaco Editor
- Backend: Node.js + Express + TypeScript
- Real-time: Socket.io
- AI layer: provider-neutral foundation with Ollama, Gemini, and Groq adapters

## Project Structure

```text
.
|-- client
|   |-- src
|   |   |-- components
|   |   |-- hooks
|   |   |-- lib
|   |   |-- pages
|   |   |-- store
|   |   `-- types
|   |-- package.json
|   `-- vite.config.ts
|-- server
|   |-- src
|   |   |-- config
|   |   |-- constants
|   |   |-- modules
|   |   |-- routes
|   |   `-- sockets
|   `-- package.json
|-- package.json
`-- README.md
```

## Features

- Create and join rooms with unique IDs
- Live shared editor state for JavaScript, Python, and C++
- Remote cursors with usernames and active-line highlighting
- Participant list with roles: owner, editor, viewer
- Real-time room chat with timestamps
- Workspace-aware AI Assistant with explain, fix, refactor, test, document, review, and summarize prompts
- Optional LiveKit voice, video, screen sharing, and device controls for room participants
- Professional dark UI with responsive collaboration-focused layout

## Launch and operations docs

- [Environment variable reference](docs/ENVIRONMENT.md)
- [Production deployment architecture](docs/DEPLOYMENT.md)
- [Realtime load-test plan](docs/LOAD_TESTING.md)
- [Manual launch checklist](docs/LAUNCH_CHECKLIST.md)

The Vercel deployment hosts only the static frontend. Creating or joining rooms in production requires `VITE_API_URL` and `VITE_SOCKET_URL` to point at the separately deployed, persistent Node + Socket.IO backend.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create these files from the provided examples:

```bash
copy server\\.env.example server\\.env
copy client\\.env.example client\\.env
```

For local AI responses, add these values to `server/.env`:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
# Optional: leave blank to use the first discovered model.
OLLAMA_MODEL=qwen2.5-coder
```

### 3. Install and run Ollama

Install Ollama from its official installer, then pull a local model and verify the service:

```bash
ollama pull qwen2.5-coder
ollama list
ollama serve
```

Ollama normally listens on `http://127.0.0.1:11434`. Code Collaborator calls that address only from the backend; the browser never receives an Ollama URL or provider credential. Open the AI Assistant in a room, choose Ollama, and select one of the models discovered from `ollama list`.

To enable a hosted provider, set one of the following only in `server/.env` and restart the backend:

```env
GEMINI_API_KEY=your-server-side-key
# Optional override; Gemini's default is gemini-2.5-flash.
GEMINI_MODEL=

GROQ_API_KEY=your-server-side-key
# Optional override; Groq's default is llama-3.3-70b-versatile.
GROQ_MODEL=
```

Provider keys are not stored in the client, sent over Socket.IO, or exposed by the provider-status endpoint. If a key is absent, that provider remains visibly unavailable while the rest of the workspace continues to work.

### Account and GitHub configuration

Supabase authentication is optional for guest collaboration. To enable accounts, set browser-safe values in `client/.env` and server-only persistence values in `server/.env`:

```env
# client/.env — safe in the browser
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# server/.env — never expose these values to the browser
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GUEST_SESSION_SECRET=a-long-random-secret
```

Existing Vercel deployments that already use `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are also supported. These are browser-safe
public values only; never expose a service-role or secret key to Vite.

Run the SQL files in `supabase/migrations/` in order. In Supabase Auth, set the Site URL and add local, preview, and production callback URLs to the redirect allow-list, including `http://127.0.0.1:5173/auth/callback` and the deployed `/auth/callback` URL. Email confirmation is supported: when it is enabled, registration shows a verification notice and does not treat the account as signed in until Supabase issues a session. Password-recovery links also return through `/auth/callback`. The Phase 7 migration adds the profile bio field and a server-only `github_connections` table; browser clients are intentionally denied access to that table.

GitHub is a connected account, not an application sign-in method. To enable it, create a GitHub OAuth application with callback URL `https://your-backend.example.com/api/github/callback`, then set these **server-only** variables:

```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=https://your-backend.example.com/api/github/callback
# A unique 32-byte value, encoded as base64 or 64 hexadecimal characters.
GITHUB_TOKEN_ENCRYPTION_KEY=
```

The connection requests `repo` and `read:user` scopes. GitHub access tokens are AES-256-GCM encrypted before server-side persistence and are never sent to the browser, room metadata, or generic profile endpoint.

### 4. Optional local voice and video

Media is optional: the editor, workspace, chat, and AI remain available without LiveKit. To test calls locally, install the LiveKit Server and run its development mode:

```bash
livekit-server --dev
```

Then add the development values to `server/.env` and restart the backend:

```env
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Open a room, select **Join call**, then explicitly enable the microphone, camera, or screen share controls you want to use. Calls are independent from the Socket.IO collaboration connection. Each media token is room-scoped, bound to the current room participant, issued by the backend, and expires after 15 minutes. Tokens are not placed in browser storage.

## Run the app

From the repository root:

```bash
npm run dev
```

This starts:

- Backend on `http://localhost:4000`
- Frontend on `http://127.0.0.1:5173`

Use `http://127.0.0.1:5173/` locally. The Vite development server is deliberately bound to that address so the documented link and API proxy use the same host.

## Production build

```bash
npm run build
```

To run the backend build:

```bash
npm run start
```

## Deploy the frontend to Vercel

Vercel serves the React frontend only. Deploy the `server` application to a persistent Node.js host that supports WebSockets, then configure the Vercel project with:

- `VITE_API_URL=https://your-backend.example.com`
- `VITE_SOCKET_URL=https://your-backend.example.com`
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` when Supabase auth is enabled

Configure that backend with:

- `PORT=4000`
- `CLIENT_URL=https://your-vercel-site.vercel.app`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` when Supabase persistence is enabled
- `GUEST_SESSION_SECRET` set to a strong private value
- `GEMINI_API_KEY` / `GEMINI_MODEL` or `GROQ_API_KEY` / `GROQ_MODEL` when using hosted AI
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` when using voice/video

The old Vercel room handlers were removed because they were a separate, incomplete API without Socket.IO, workspace state, or AI routes. Leaving them in place caused the hosted frontend to call the wrong backend.

Local Ollama is not reachable from Vercel. A deployed backend must be able to reach the configured `OLLAMA_BASE_URL`; use a hosted Ollama instance or run the backend and Ollama in the same private network.

For media, deploy LiveKit separately (self-hosted or managed) and configure the long-running Node backend with its WebSocket URL and signing credentials. The frontend only receives a short-lived room token after server-side room-session validation. Vercel can host the frontend, but it is not the LiveKit server or the Socket.IO backend. Production camera, microphone, and screen sharing require HTTPS and a `wss://` LiveKit endpoint. A production LiveKit deployment also needs its documented WebRTC/TURN ports reachable for reliable connectivity.

### Two-browser media verification

After configuring LiveKit, open the same room in Browser A and Browser B (or an incognito window), each with its own room participant. In both windows, select **Join call**. Then verify the following in order:

1. Enable Browser A's microphone; Browser B should receive its audio after selecting **Enable remote audio** if the browser blocks autoplay.
2. Enable Browser A's camera, mute and unmute it, then switch its selected camera or microphone in **Devices**. Browser B should show the matching camera and microphone status.
3. Start screen sharing in Browser A, confirm Browser B sees the large, unmirrored shared screen while its editor remains accessible, then stop it using the browser's native **Stop sharing** control.
4. Leave the call from Browser A, rejoin it, and confirm there is only one tile and no duplicate audio. Keep editing, chatting, and moving the cursor while both calls are active to confirm Socket.IO collaboration continues normally.
5. Deny a microphone or camera request once and verify the call remains usable, with a clear permission message. Finally, delete the room while a call is active and confirm both windows stop capture, disconnect, and return to the existing room-deletion flow.

Use HTTPS and a `wss://` endpoint for remote or production testing; browser capture is intentionally restricted on insecure origins.

## Notes

- Room state is currently stored in memory on the backend, which keeps the project simple and modular for local development.
- Ollama is available locally; Gemini and Groq are optional server-side providers. OpenRouter, OpenAI, Anthropic, and custom providers remain intentionally unconfigured extension points.
- LiveKit is the optional media provider. The room toolbar opens a collapsible call panel with join/leave, microphone, camera, screen-share, device, participant, and reconnect controls. No capture starts on room entry or call join; each capture control requires a direct user action.
- Automated tests verify token authorization, guest identity binding, spoofed identity rejection, disabled-provider behavior, media state transitions, and user-safe permission messages. Real multi-user webcam, microphone, speaker, and screen-sharing verification requires a configured LiveKit server and browser device access.
- The AI context is selectively built from the current file, selection, relevant tabs, workspace summary, room activity, and Git metadata; it is strictly budgeted and excludes common secret-bearing files such as `.env`, credentials, private keys, and certificates.
- Language switching currently resets the editor to that language's starter template.
- If Ollama is not installed, not running, or has no models, collaboration features remain available and the AI panel reports the unavailable state.
- Guest sessions are signed per room. Keep `GUEST_SESSION_SECRET` stable in every backend environment; changing it invalidates existing guest sessions.
# Analytics and dashboard

Phase 8 adds a private, first-party analytics foundation backed by Supabase. The dashboard requests `GET /api/analytics/me?range=7d|30d|90d|all`; identity is derived from the verified bearer token and callers cannot pass a user ID.

The server records only low-frequency, allow-listed metadata for authenticated members: room creation/join, completed or failed AI requests, and extension points for execution, Git/GitHub, media, workspace, and file actions. It never records source code, file contents, chat messages, AI prompts/responses, passwords, API keys, GitHub tokens, audio/video, or screen-share contents. Guest coding remains fully available and does not create persistent analytics records.

Apply `supabase/migrations/202608180002_analytics.sql` after earlier migrations. `analytics_events` has RLS enabled and browser roles are revoked; the server service-role client is the only writer/reader. The dashboard response is server-aggregated, capped at 500 events and 20 recent activity items, with a short per-user/range cache. Analytics writes fail open and cannot block application features.

Raw analytics events should be removed after 90 days by a production scheduler running with server-only Supabase credentials. This retention policy applies only to `analytics_events`, never rooms, workspaces, project content, chat, or AI conversation history.
