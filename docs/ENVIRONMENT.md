# Environment reference

Copy `client/.env.example` to `client/.env` and `server/.env.example` to `server/.env` for local development. Do not commit either file. The server loads `server/.env`; Vite reads client-side variables at build time.

All variables below are taken from the current client Vite configuration or `server/src/config/env.ts`.

| Variable | Client / server | Required? | Purpose | Safe to expose in browser? |
| --- | --- | --- | --- | --- |
| `VITE_API_URL` | Client | Required for a Vercel production frontend | Public HTTPS origin of the persistent Express API. Empty locally uses the Vite proxy. | Yes |
| `VITE_SOCKET_URL` | Client | Required for a Vercel production frontend | Public HTTPS origin of the persistent Socket.IO backend. | Yes |
| `VITE_PUBLIC_SITE_URL` | Client | Optional | Canonical and Open Graph URL base. | Yes |
| `VITE_SUPABASE_URL` | Client | Optional; required with the anon key for browser authentication | Supabase project URL. | Yes |
| `VITE_SUPABASE_ANON_KEY` | Client | Optional; required with the project URL for browser authentication | Browser-safe Supabase anon or publishable key. | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Client | Optional compatibility alias | Legacy browser-safe fallback for `VITE_SUPABASE_URL`. Prefer the `VITE_` name. | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client | Optional compatibility alias | Legacy browser-safe fallback for `VITE_SUPABASE_ANON_KEY`. Prefer the `VITE_` name. | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client | Optional compatibility alias | Legacy browser-safe publishable-key fallback. Prefer `VITE_SUPABASE_ANON_KEY`. | Yes |
| `NODE_ENV` | Server | Required in production | Set to `production` so startup enforces production validation. | No |
| `PORT` | Server | Optional | HTTP port. A valid value is used; otherwise the server defaults to `4000`. | No |
| `CLIENT_URL` | Server | Required in production | Comma-separated HTTPS frontend origins allowed by Express CORS and Socket.IO. | No |
| `GUEST_SESSION_SECRET` | Server | Required in production | Private HMAC secret used to sign room guest sessions; production requires a unique value of at least 32 characters. | No |
| `SUPABASE_URL` | Server | Optional; required with the service-role key for server persistence/member verification | Supabase project URL used by the server admin client. | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Optional; required with `SUPABASE_URL` for server persistence/member verification | Server-only Supabase service-role credential. Never place it in Vite or browser configuration. | No |
| `OLLAMA_BASE_URL` | Server | Optional | Backend-reachable Ollama HTTP URL. The code defaults to a local Ollama URL when unset. | No |
| `OLLAMA_MODEL` | Server | Optional | Default Ollama model; blank allows discovery of an installed model. | No |
| `GEMINI_API_KEY` | Server | Optional | Server-only Gemini provider credential. | No |
| `GEMINI_MODEL` | Server | Optional | Optional Gemini model override. | No |
| `GROQ_API_KEY` | Server | Optional | Server-only Groq provider credential. | No |
| `GROQ_MODEL` | Server | Optional | Optional Groq model override. | No |
| `LIVEKIT_URL` | Server | Optional; all three LiveKit variables must be supplied together | Public `ws:` or `wss:` LiveKit endpoint used to issue room tokens. | No |
| `LIVEKIT_API_KEY` | Server | Optional; all three LiveKit variables must be supplied together | LiveKit server signing credential. | No |
| `LIVEKIT_API_SECRET` | Server | Optional; all three LiveKit variables must be supplied together | LiveKit server signing credential. | No |
| `GITHUB_CLIENT_ID` | Server | Optional; all four GitHub variables must be supplied together | GitHub OAuth application client identifier. | No |
| `GITHUB_CLIENT_SECRET` | Server | Optional; all four GitHub variables must be supplied together | GitHub OAuth application client secret. | No |
| `GITHUB_REDIRECT_URI` | Server | Optional; all four GitHub variables must be supplied together | Public backend callback URL ending in `/api/github/callback`. | No |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Server | Optional; all four GitHub variables must be supplied together | Private key used to encrypt stored GitHub access tokens. | No |

Vite deliberately exposes both `VITE_` and `NEXT_PUBLIC_` prefixes because `client/vite.config.ts` configures both. Only the browser-safe Supabase URL and anon/publishable key use the legacy `NEXT_PUBLIC_` aliases. Prefer the `VITE_` names for new deployments.

`SUPABASE_JWT_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and `PISTON_URL` are not read by the current application source and are not deployment requirements.
