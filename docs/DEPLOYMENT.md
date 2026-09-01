# Deployment architecture

Code Collaborator has a static Vercel frontend and a persistent Render/Node backend.

```text
Browser
  ├── HTTPS ───────────────> Vercel: Vite/React frontend
  └── HTTPS + Socket.IO ───> Render: Express + Socket.IO backend
                                  ├── Optional Supabase room persistence
                                  ├── Optional AI providers
                                  └── Optional LiveKit token service
```

Authentication is not part of the product. A visitor chooses a display name, receives a server-signed room guest token, and can create or join a room immediately. The server remains authoritative for membership, socket binding, owner actions, and persistence.

## Frontend deployment: Vercel

Use the repository root (`.`) as the Vercel project root. The committed [`vercel.json`](../vercel.json) selects the Vite/React frontend, runs `npm run build --workspace client`, publishes `client/dist`, and rewrites SPA routes to `index.html`. If the Vercel project is intentionally configured with `client/` as its root, use the equivalent `client/vercel.json` settings (`npm run build`, output `dist`) instead; do not combine the two root-directory layouts.

Set these browser-safe build variables:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://code-collaborator-backend.onrender.com` |
| `VITE_SOCKET_URL` | `https://code-collaborator-backend.onrender.com` |
| `VITE_PUBLIC_SITE_URL` | `https://code-collabrator-client.vercel.app` (optional, but recommended for canonical metadata) |

Do not set Supabase variables in Vercel. The browser does not initialize Supabase and must never receive `SUPABASE_SERVICE_ROLE_KEY`.

## Backend deployment: Render

Deploy the repository as a persistent Web Service using the existing `Dockerfile`. The Render root directory is the repository root (`.`). The container starts `node server/dist/index.js`; an equivalent non-Docker service uses the repository-root commands below. The service must support HTTPS, WebSocket upgrades, and Render's host-provided `PORT` (the server listens on that port and does not require a fixed public port).

```bash
npm ci
npm run build --workspace server
npm run start --workspace server
```

Required production variables:

- `NODE_ENV=production`
- `CLIENT_URL=https://code-collabrator-client.vercel.app`
- `GUEST_SESSION_SECRET` with a unique value of at least 32 characters

Optional persistence variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional AI, media, and GitHub variables are documented in [ENVIRONMENT.md](ENVIRONMENT.md). All provider credentials remain server-only.

### GitHub project workflow

Set `GITHUB_TOKEN` only as a Render/server environment variable if the deployment should import and update GitHub repositories. The Source control panel performs a guest-session-scoped explicit connection, repository list, branch selection, bounded import, status/diff, branch, commit-plan, push, pull, and pull-request workflow through the backend. The browser never receives the token and the API only targets the fixed GitHub API origin. The current foundation is deployment-token based, not OAuth or per-user GitHub identity; scope the token to the repositories the deployment is allowed to use.

The import limit is 500 files and 4 MB of text. Secret-like paths and binary/oversized files are not imported. Push is non-force and rechecks the remote branch head, while pull and branch switching stop when local collaborator changes exist. The workspace/project metadata is compatible with existing room snapshots, but the in-memory import baseline is lost on a backend restart and must be re-imported; no database migration is applied automatically. Do not add `GITHUB_TOKEN` or any GitHub credential to Vercel `VITE_*` variables.

### AI on the persistent backend

AI requests run through the Express backend so provider credentials never reach the browser. The current adapters are Ollama, Gemini, Groq, OpenRouter, OpenAI, and Anthropic. For a local Ollama backend, run `ollama serve`, pull an installed model (for example `ollama pull qwen3.5:latest`), and use `OLLAMA_BASE_URL`/`OLLAMA_MODEL` on the server. In production, the backend must be able to reach the configured Ollama URL; do not put a localhost Ollama URL in Vercel. Configure cloud provider keys only as Render server variables. `GET /api/ai/providers` returns safe availability, capabilities, and discovered model metadata only. A missing or unhealthy provider does not block the rest of the workspace.

### Coding-agent deployment behavior

The coding agent is served by the same persistent backend as the normal AI routes. The browser calls `POST /api/ai/rooms/:roomId/agent` or its SSE counterpart and includes the signed guest token; the server resolves the room and workspace instead of trusting client-supplied paths or workspace IDs. Configure at least one available provider/model before using the panel.

The runtime exposes only `READ_FILE`, `LIST_FILES`, `SEARCH_CODE`, `GET_CURRENT_FILE`, `GET_SELECTION`, `GET_WORKSPACE_SUMMARY`, `GET_PROJECT_INDEX`, `GET_RELATED_FILES`, `GET_PACKAGE_INFO`, `GET_TASK_HISTORY`, `GET_DIAGNOSTICS`, `APPLY_PATCH`, and `RUN_VALIDATION`. It does not expose unrestricted shell or host filesystem access. `GET_PROJECT_INDEX` is built from bounded safe virtual-workspace metadata; related-file and package tools return metadata only; room task history excludes raw prompts and provider credentials. `RUN_VALIDATION` accepts only fixed `typecheck`, `lint`, `tests`, and `build` categories. Agent loops are bounded to eight iterations, twenty tool calls, a 90-second deadline, and bounded tool/provider context.

Agent edits are proposals by default. Each proposal records the authoritative base editor version. `POST /api/ai/rooms/:roomId/agent/patch` applies a user-approved proposal only after rechecking its room, workspace, file(s), base version, stable expected content for every file, and patch identity. Multi-file proposals are bounded and validated completely before one room version update, so a stale file cannot cause a partial apply. Any intervening collaborator or workspace edit makes the proposal stale and it must be regenerated. Proposal-created, approved, rejected, stale, and applied lifecycle events are broadcast as small room-safe status events; reconnect-safe previews contain only bounded, secret-filtered review data, while full patch content is returned only to an authorized room participant who requests that specific proposal. Successful changes are persisted through the existing room persistence service and broadcast as `editor:sync` and `workspace:sync` events, so connected guests converge on the same room snapshot. No deployment, Vercel, Render, or Supabase migration is performed by the agent.

The agent also exposes bounded proposal-state/history endpoints and an explicit `POST /api/ai/rooms/:roomId/agent/validate` endpoint. Validation categories are fixed and the response reports pass, fail, skipped, unavailable, or cancelled honestly; it does not claim that the external Programiz runner produced output. Provider recommendations are informational and never override the provider/model selected by the guest.

Each request carries a room-scoped conversation ID and task ID. Server task states are validated across queued, planning, running, waiting-for-approval, applying, validating, completed, cancelled, failed, timed-out, and conflict states. Reconnects receive bounded history, older task updates cannot overwrite newer ones, and a duplicate task ID is rejected.

Phase 6F adds a per-room project-index cache with an explicit workspace fingerprint and invalidation on workspace edits. The index is limited to 500 files and includes bounded summaries, entry points, directories, package metadata, and import-aware related-file ranking. Task classification and provider recommendations are advisory; they never grant extra access or silently change the guest's provider choice. Debug responses may stream bounded confirmed, likely, or possible hypotheses with evidence, while review findings remain structured and location-aware.

The client can request cancellation for an active task and can continue a bounded prior task using the current room state. Reconnects receive room-scoped task history, proposal lifecycle, and bounded proposal previews through Socket.IO; full patch content is fetched only for an authorized review/apply action. Room deletion aborts and clears in-memory agent indexes, tasks, memory, and proposal state, preventing later application or persistence resurrection. Agent request, patch, validation, and API rate limits are configurable server settings with hard upper bounds; iteration, tool-call, and timeout limits remain bounded. These controls do not add authentication or change the database-only Supabase architecture.

Validation reports not-run, running, passed, failed, skipped, or unavailable. Because room files are virtual and are not materialized into a separate execution sandbox, automatic post-apply validation is skipped; explicit checks run fixed backend workspace commands and do not execute arbitrary room code or claim that room code passed.

Monaco diagnostics are sent to the agent as bounded structured evidence. The external Programiz runner does not return execution output to the browser, so opening it does not create an execution result; the agent receives no execution evidence unless a real result is supplied by an existing runner.

## Supabase room persistence

Supabase is database-only; it is not an authentication requirement and the browser does not create a Supabase client. For the current guest-first room persistence path, apply these migrations in lexical order:

1. `supabase/migrations/202608030001_auth_persistence.sql` — legacy filename; creates the database-only `rooms`, `room_members`, and `room_history` tables.
2. `supabase/migrations/202608050001_workspace.sql` — adds the durable workspace snapshot column used by the server.
3. `supabase/migrations/202608260001_guest_database_only.sql` — removes Auth foreign keys and policies from databases that applied the earlier legacy schema.

The later analytics and GitHub/account migrations are not required for guest room collaboration. Apply them only when those separately implemented server features are enabled. The active room persistence layer stores room/workspace snapshots, code, chat, bounded history, and membership metadata. It deliberately does not persist socket IDs, online/presence state, cursors, or typing state. Writes are debounced for editor changes and serialized by room/version so an older snapshot cannot overwrite a newer one. The service-role client remains server-only.

Persistence failures are caught and logged with safe diagnostic messages containing the database error code, message, details, and hint; credentials are never logged. In-memory rooms and guest collaboration continue when persistence is unavailable. `/health` is process liveness; `/ready` remains available and reports separate persistence configuration and schema/database health. Restarting the backend then loses rooms that were not persisted. Deletion first invalidates the authoritative in-memory room, then attempts the durable `deleted_at` tombstone; a failed durable write returns a controlled `503` while the room remains deleted in the current process.

Room lifecycle and reconnect behavior:

- Create/join validates the room ID, display name, signed guest session, and supported language.
- The server owns room membership and ownership. Guest sessions are HMAC-signed with `GUEST_SESSION_SECRET`; no account is needed.
- Socket reconnect validates the same guest token, replaces only the participant's stale socket binding, and sends the latest room snapshot. A prior socket cannot mark a newer socket offline.
- Chat and history are bounded and deduplicated by stable IDs. Presence and typing are cleared on disconnect and rebuilt after reconnect.
- Quick Rejoin remains browser-local (maximum five validated, newest-first rooms); deleted or nonexistent rooms are removed during its health check.

## IDE workspace and execution

The room page provides a bounded collaborative IDE surface: Explorer/Search/Source control/AI/Run & Debug activity, shared file operations, tabs and breadcrumbs, command palette shortcuts, Monaco Problems, collaborator presence, and Terminal/Tests/Problems/Output tabs. Search and project context remain bounded at 500 files and 20 relevant/results items. File operations reject traversal, protected secret/VCS names, oversized content, and unauthorized room/workspace IDs. The top toolbar stays focused on room and communication controls, while execution and AI controls remain in the workspace panels.

`Run project` for virtual room source copies the active file and opens the configured Programiz page for JavaScript, Python, or C++. Cross-origin browser security prevents Code Collaborator from reading that page's output, so the panel reports only that the external runner opened (or that copying/pop-up access failed); it never displays fabricated stdout, stderr, timing, exit code, or success. Copy Code uses the browser Clipboard API with a visible failure state, and Download File creates the exact active source with a language-appropriate extension.

The backend also exposes explicit safe validation endpoints under `/api/rooms/:roomId/execution`. They accept only fixed `tests`, existing in-scope `server/test/*.test.cjs` targets, `build`, `typecheck`, `lint`, and `diagnostics` actions. No shell string, arbitrary executable, package install, network command, host path, destructive Git action, or room-source execution is accepted. Processes run with `shell: false`, a credential-filtered environment, bounded output, cancellation, timeout, concurrency, per-room rate, request-ID deduplication, and a 40-entry room/workspace history. State is sent over Socket.IO on `execution:state`; join/reconnect receives the latest history. Terminal statuses are queued, running, completed, failed, cancelled, timed out, and unavailable. `/ready` reports safe execution capability and limits without exposing environment values.

Execution status can be included in the existing AI request context when a real fixed-check result or external-runner error is known. It does not claim output that the browser cannot observe. Diagnostics are bounded structured evidence; repository and command output are untrusted data and never override security rules.

## Production verification

1. Check `GET /health` and `GET /ready`.
2. Open the Vercel frontend without signing in.
3. Create a room, refresh it, and rejoin from Quick Rejoin.
4. Join from a second browser and verify editor, chat, presence, typing, and cursors.
5. Confirm a non-owner cannot delete or manage the room.
6. Delete as the owner and confirm all clients leave, Quick Rejoin removes the room, and GET/JOIN return 404.
7. If GitHub is configured, connect from Source control, import a test repository, edit a file with a second guest, verify status/diff, stage and prepare a commit, push explicitly, pull a remote change, and create a test pull request. Verify that unsaved local changes block pull/branch switch and that no token appears in browser storage or API responses.

After any source or Vercel-variable change, trigger a new **Production** deployment. A previously deployed Vercel build does not change when environment variables are edited. The landing page must be guest-first (display-name field and Create/Join Room controls); a deployed page showing Sign in/Sign up is an obsolete build and must be rebuilt from the current repository.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| Failed to fetch | Confirm `VITE_API_URL` is the backend origin and `/health` responds. |
| Socket.IO failure | Confirm `VITE_SOCKET_URL`, WebSocket support, and exact `CLIENT_URL`. |
| CORS error | Set `CLIENT_URL` to the exact frontend origin; production origins must use HTTPS. |
| Room session invalid | Rejoin from the landing page; changing `GUEST_SESSION_SECRET` invalidates prior guest tokens. |
| Persistence unavailable | Check server logs and both Supabase variables. Guest rooms still work in memory. |
| Vercel SPA 404 | Confirm the Vercel project uses the committed SPA rewrite and the correct client output directory. |
| Stale Vercel UI | Confirm the project root is `.` (or consistently `client/`), redeploy Production from the current commit, and verify the generated asset no longer contains obsolete auth routes. |
| Render startup failure | Check the Docker build/start logs, keep `NODE_ENV=production`, provide a valid guest-session secret, and allow Render to supply `PORT`. |

## Product-quality verification notes

The deployed experience is still guest-first: visitors choose a display name, create or join a room, and use the workspace without login or browser authentication. The AI assistant uses the same Render backend as the normal AI routes. Configure at least one server-side provider/model before testing AI; an unavailable provider is shown as unavailable and is not silently replaced.

For an agent smoke test, ask for an explanation first, then request an edit and confirm that a proposal appears with files, line counts, review findings, and explicit Apply/Reject controls. Change the file from another collaborator before applying and verify that the proposal says the files changed while the AI was working and offers Regenerate/Review current file. If a provider returns malformed structured JSON, the backend retries once and then returns a safe `INVALID_MODEL_OUTPUT` result without executing a tool or changing the workspace. Streaming events are also validated by the client.

Image attachments currently provide a local preview and filename only because no shipped provider advertises vision support. `Run project` remains an external-runner/export flow; Code Collaborator cannot observe that runner's output cross-origin. Automatic Vercel/Render deployment is not performed by the workspace Deploy panel. These limitations should be reported during production QA rather than represented as successful provider or deployment results.
