# Environment reference

Copy `client/.env.example` to `client/.env` and `server/.env.example` to `server/.env` for local development. Never commit either file.

| Variable | Side | Required | Purpose |
| --- | --- | --- | --- |
| `VITE_API_URL` | browser | Production | HTTPS URL of the persistent Express API. Empty locally uses the Vite proxy. |
| `VITE_SOCKET_URL` | browser | Production | HTTPS URL of the persistent Socket.IO backend. |
| `VITE_PUBLIC_SITE_URL` | browser | Optional | Canonical/Open Graph base URL; browser-visible. |
| `VITE_SUPABASE_URL` | browser | Auth | Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | browser | Auth | Supabase anon/publishable key only. |
| `PORT` | server | Optional | HTTP port; defaults to `4000`. |
| `NODE_ENV` | server | Production | Set to `production` to enforce production validation. |
| `CLIENT_URL` | server | Production | Comma-separated frontend origins allowed by CORS/Socket.IO. |
| `GUEST_SESSION_SECRET` | server | Production | Unique private HMAC secret, 32+ characters. |
| `SUPABASE_URL` | server | Persistence | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Persistence | Server-only Supabase service-role key. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | server | Optional | Backend-local Ollama endpoint and optional default model. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | server | Optional | Gemini server-side provider configuration. |
| `GROQ_API_KEY`, `GROQ_MODEL` | server | Optional | Groq server-side provider configuration. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | server | Optional together | LiveKit websocket endpoint and server-only signing credentials. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`, `GITHUB_TOKEN_ENCRYPTION_KEY` | server | Optional together | GitHub OAuth and encrypted token storage. |

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are accepted only by the Vite browser build for compatibility with the current Vercel project. Prefer the `VITE_` names for new deployments. No `VITE_` value may contain a service-role key, OAuth secret, AI key, LiveKit secret, JWT secret, or guest-session secret.
