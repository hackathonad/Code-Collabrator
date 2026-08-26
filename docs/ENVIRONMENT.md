# Environment reference

Copy `client/.env.example` and `server/.env.example` for local development. The browser only receives public endpoint values; guest tokens are issued and verified by the server.

| Variable | Client / server | Required? | Purpose | Safe to expose in browser? |
| --- | --- | --- | --- | --- |
| `VITE_API_URL` | Client | Required for a Vercel production frontend | Public HTTPS origin of the Express API. Empty locally uses the Vite proxy. | Yes |
| `VITE_SOCKET_URL` | Client | Required for a Vercel production frontend | Public HTTPS origin of the Socket.IO backend. | Yes |
| `VITE_PUBLIC_SITE_URL` | Client | Optional | Canonical and Open Graph URL base. | Yes |
| `NODE_ENV` | Server | Required in production | Enables production validation. | No |
| `PORT` | Server | Optional | HTTP port; defaults to `4000`. | No |
| `CLIENT_URL` | Server | Recommended in production | Comma-separated frontend origins allowed by CORS and Socket.IO. Production falls back to the shipped Vercel origin when omitted. | No |
| `GUEST_SESSION_SECRET` | Server | Required in production | Private HMAC secret for room guest sessions; production requires at least 32 unique characters. | No |
| `SUPABASE_URL` | Server | Optional; required with the service-role key | Supabase project URL for optional room persistence. | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Optional; required with `SUPABASE_URL` | Server-only database credential. Never place it in Vite or browser configuration. | No |
| `OLLAMA_BASE_URL` | Server | Optional | Backend-reachable Ollama URL; defaults to a local Ollama URL. | No |
| `OLLAMA_MODEL` | Server | Optional | Default Ollama model; blank enables discovery. | No |
| `GEMINI_API_KEY` | Server | Optional | Server-only Gemini credential. | No |
| `GEMINI_MODEL` | Server | Optional | Gemini model override. | No |
| `GROQ_API_KEY` | Server | Optional | Server-only Groq credential. | No |
| `GROQ_MODEL` | Server | Optional | Groq model override. | No |
| `OPENROUTER_API_KEY` | Server | Optional | Server-only OpenRouter credential. | No |
| `OPENROUTER_MODEL` | Server | Optional | OpenRouter model override. | No |
| `OPENAI_API_KEY` | Server | Optional | Server-only OpenAI credential. | No |
| `OPENAI_MODEL` | Server | Optional | OpenAI model override. | No |
| `ANTHROPIC_API_KEY` | Server | Optional | Server-only Anthropic credential. | No |
| `ANTHROPIC_MODEL` | Server | Optional | Anthropic model override. | No |
| `LIVEKIT_URL` | Server | Optional; all three LiveKit values are required together | Public `ws:`/`wss:` media endpoint. | No |
| `LIVEKIT_API_KEY` | Server | Optional; all three LiveKit values are required together | LiveKit signing credential. | No |
| `LIVEKIT_API_SECRET` | Server | Optional; all three LiveKit values are required together | LiveKit signing credential. | No |

Supabase is database-only in this product. There are no browser Supabase variables and no Supabase Auth session requirement. If persistence is disabled or unavailable, the server keeps rooms in memory and `/ready` reports `persistence.configured`, `persistence.healthy`, and a generic status without exposing provider details to the browser.

The current client intentionally does not read `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`; do not add them to the frontend. Browser-local state is limited to signed guest sessions, Quick Rejoin, cached room snapshots, themes, and AI settings/conversations. Socket IDs, presence, cursors, typing state, and provider credentials are never stored there.

## Coding-agent runtime

The agent is enabled by the existing AI provider configuration; it does not require a new environment variable. Requests run on the backend against the authoritative guest-authorized room workspace. The runtime supports Ask, Edit, Debug, and Explain modes, nine bounded virtual-workspace tools, streamed activity events, and approval-gated exact patches. It never uses Supabase Auth or browser Supabase credentials.

Validation tools use fixed npm categories (`typecheck`, `lint`, `tests`, `build`), `shell: false`, bounded output, and a 30-second limit. The child process environment removes variables whose names indicate API keys, secrets, tokens, passwords, Supabase, or guest-session credentials. Do not add provider credentials to client variables or include secrets in workspace files.

`SUPABASE_JWT_SECRET` and `PISTON_URL` are not read by the current source and are not deployment requirements. OpenAI, Anthropic, and OpenRouter credentials are read only by the server-side AI adapters.

## AI provider setup

The implemented adapters are Ollama, Gemini, Groq, OpenRouter, OpenAI, and Anthropic. Provider credentials and upstream URLs stay on the persistent backend; no AI secret belongs in a `VITE_*` variable. The cloud adapters discover models through their provider model endpoints and cache the result briefly. For local development, run `ollama serve`, pull a model such as `qwen3.5:latest`, and leave `OLLAMA_MODEL` blank to select the first discovered model (or set it to an installed model name). The client reads only the safe provider catalog from `GET /api/ai/providers`. A provider is shown as not configured, unavailable, or available; unavailable providers cannot send requests, while rooms, editing, chat, and Socket.IO remain usable.
