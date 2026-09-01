# Code Collaborator

Code Collaborator is a full-stack realtime collaborative coding application. It uses a Vite/React client, an Express + Socket.IO server, optional Supabase room persistence, and optional AI and LiveKit integrations. Open the app, choose a display name, and collaborate immediately—no account or authentication is part of the current product.

**Live project:** [Open Code Collaborator](https://code-collabrator-client.vercel.app/) | [GitHub repository](https://github.com/hackathonad/Code-Collabrator)

## Architecture

```text
Browser
  ├─ HTTPS ──────────────> Vercel: Vite/React static frontend
  └─ HTTPS + Socket.IO ──> Persistent Node.js: Express + Socket.IO backend
                                  ├─ Optional Supabase room persistence
                                  ├─ Optional AI providers
                                  └─ Optional LiveKit token service
```

Vercel serves the frontend build and rewrites SPA routes to `index.html`. It is not the persistent realtime server. Room collaboration uses a long-running Socket.IO process and server memory; the backend has no Socket.IO adapter for horizontal fan-out. Deploy one persistent backend instance with WebSocket support. See [deployment architecture](docs/DEPLOYMENT.md) for the production topology and provider setup.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind, Monaco Editor
- Backend: Node.js, Express, TypeScript, Socket.IO
- Optional persistence: Supabase database
- Optional AI: Ollama, Gemini, Groq, OpenRouter, OpenAI, Anthropic
- Optional media: LiveKit
- Optional GitHub project workflow: server-side GitHub API adapter with bounded virtual-workspace import
- Bounded IDE workspace: Explorer/Search, command palette, Problems, Tests, safe validation output, and collaborator-aware execution state

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
npm run test:media-client
npm run test --workspace server
npm run test:ai --workspace server
npm run test:agent --workspace server
npm run test:collaboration --workspace server
npm run test:media --workspace server
```

## Features

- Public guest-first workspace at `/`, `/home`, `/app`, `/room/:roomId`, and `/guest`
- Signed guest sessions that preserve room identity across refresh and reconnect
- Create and join rooms with unique IDs
- Live shared editor state for JavaScript, Python, and C++
- Remote cursors, participant roles, chat, typing indicators, and workspace files
- Workspace-aware AI actions for explain, fix, refactor, test, document, review, and summary tasks
- Safe coding-agent modes (Ask, Edit, Debug, Explain) with virtual-workspace tools, streamed activity, and approval-gated patches
- Honest run workflow: copy/download source and open a language-matched external runner
- Optional LiveKit voice, video, screen sharing, and device controls
- GitHub Source control workflow: connect a server-configured GitHub integration, import a repository branch, browse/edit it collaboratively, inspect status and diff, stage, prepare a commit, push without force, pull safely, create branches, and open pull requests

## Supabase and optional services

Rooms do not require an account. `/`, `/app`, and `/room/:roomId` accept a display name and use server-signed guest sessions. `/guest` and `/guest/room/:roomId` remain explicit guest aliases. The browser does not initialize Supabase; the server uses an optional service-role client only for room snapshots, participants, and bounded history. Never expose `SUPABASE_SERVICE_ROLE_KEY` in the client or a `VITE_*` variable.

Supabase is optional persistence infrastructure. If it is unavailable, in-memory room collaboration and guest sessions continue to work for the lifetime of the backend process.

### Data and room lifecycle

- The backend `roomStore` is authoritative for live room state, workspace files, bounded chat, bounded history, ownership, and participant membership.
- Socket.IO presence, cursors, typing indicators, socket bindings, and connection status are realtime/ephemeral. They are cleared on disconnect and are never restored as online from persistence.
- Quick Rejoin, signed guest sessions, cached room snapshots, themes, and AI settings/conversations are browser-local. Corrupt localStorage entries are ignored and cleaned rather than treated as valid rooms.
- When Supabase is configured, room snapshots, workspace content, chat, bounded history, and membership metadata are persisted with debounced, ordered writes. Supabase errors do not expose credentials or raw provider details to the browser.
- Room deletion is owner-authorized and invalidates the room before active clients are told to leave. Deleted rooms are removed from Quick Rejoin and subsequent room reads/joins return `404`.
- A reconnect validates the signed guest session, rejoins the room, and receives the latest authoritative snapshot. Older snapshots and duplicate chat/history events cannot replace newer client state.

If Supabase is unavailable or not configured, the same guest-first collaboration fallback remains available in backend memory. That fallback is not permanent storage; rooms are lost when the backend process is replaced or restarted.

Apply the SQL files in `supabase/migrations/` in lexical order. The exact migration list, redirect requirements, and full environment reference are documented in [deployment architecture](docs/DEPLOYMENT.md) and [environment reference](docs/ENVIRONMENT.md).

Ollama runs on the backend machine or network, not in the browser. Gemini, Groq, OpenRouter, OpenAI, Anthropic, and LiveKit remain optional; leaving an integration unconfigured does not disable rooms, editing, or chat.

## Optional integrations

AI provider credentials remain server-only and are never sent over Socket.IO or returned by provider-status responses. If Ollama is not installed, cannot be reached, or has no models, the collaboration workspace remains available and the AI panel reports the provider state. Gemini and Groq are enabled only when their server credentials are configured.

For local Ollama development, start Ollama on the same machine as the backend, then pull at least one model (the verified example is `qwen3.5:latest`):

```bash
ollama serve
ollama pull qwen3.5:latest
```

The server discovers installed/cloud models and exposes only non-secret provider/model status through `GET /api/ai/providers`. Leave `OLLAMA_MODEL` blank to use the first discovered model, or set it to a discovered model name. The AI panel's Refresh control re-reads the cached model catalog. Ollama is not contacted directly by the browser and a local Ollama URL must not be used as a production Vercel variable. Configure cloud provider variables in the backend environment only when those providers are actually needed. The panel shows every provider as not configured, unavailable, or available; only available providers with a discovered model can send requests.

LiveKit is optional. Calls use short-lived backend-issued room tokens that are bound to the current participant. Camera, microphone, and screen capture require direct browser user actions. Production media requires HTTPS and a secure `wss:` LiveKit endpoint.

## GitHub project workflow

The Source control activity uses the existing workspace/editor rather than creating a second local checkout. With `GITHUB_TOKEN` configured on the backend, a guest explicitly connects GitHub for the current room session, selects an authorized repository and branch, and imports up to 500 bounded text files into the shared virtual workspace. The server derives working-tree status and diffs from the imported baseline, protects branch switching and pull from unsaved collaborator changes, and keeps staged state room/workspace scoped.

Commit preparation, push, branch creation/switching, pull, and pull-request creation require explicit user actions. Push uses GitHub's Git Data API with `force: false` and rejects a remote-ahead branch; there is no shell Git, arbitrary remote URL, force push, branch deletion, or history rewrite. The coding agent can read the bounded project context and actual diff, review it, and suggest commit/PR text, but it cannot silently write to GitHub. The integration is intentionally server-token based rather than OAuth because the product remains guest-first; the token is never exposed to the browser or persisted in room state. See [environment reference](docs/ENVIRONMENT.md) for limits and the restart/persistence boundary.

## Coding-agent workflow

The AI panel uses one guest-authorized agent runtime for Ask, Edit, Debug, and Explain modes. The runtime follows a bounded understand → context → inspect → diagnose/plan → propose → review → approve → apply → synchronize → validate flow. It sends normalized requests through the selected server-side provider, limits the loop to eight iterations and twenty tool calls, and emits concise context, status, plan, tool, validation, patch-review, final, and error events. Provider output is never treated as a permission grant.

The tool registry is deliberately narrow: `READ_FILE`, `LIST_FILES`, `SEARCH_CODE`, `GET_CURRENT_FILE`, `GET_SELECTION`, `GET_WORKSPACE_SUMMARY`, `GET_PROJECT_INDEX`, `GET_RELATED_FILES`, `GET_PACKAGE_INFO`, `GET_TASK_HISTORY`, `GET_DIAGNOSTICS`, `APPLY_PATCH`, and `RUN_VALIDATION`. Tools read the authoritative in-memory room workspace; they do not access the host filesystem. Paths are workspace-relative and reject traversal, absolute paths, ignored directories, and common secret files/content. Project indexing is bounded to safe virtual-workspace metadata, symbols, imports, tests, configs, scripts, and dependency names.

Edit and Debug modes can return exact patch proposals. A proposal contains the file path(s), expected old content, replacement(s), base editor version, line-change summary, review findings, and a stable patch ID. Applying it requires a separate user action and the server rechecks the room session, workspace, file path(s), patch identity, base version, and every exact content match before atomically updating the batch. Any collaborator or workspace edit advances the version and marks pending proposals stale; the server never silently overwrites newer room state. Proposal-created, approved, rejected, stale, and applied lifecycle events are shared without private provider details or hidden reasoning. Approved changes flow through `roomStore`, persistence, and Socket.IO synchronization.

Complex requests receive a bounded context map and explicit plan before model work. Review mode returns structured severity, evidence, and suggestions; refactor and test actions remain proposal-first. The panel shows recent room-scoped task history, patch review findings, and an explicit validation control. Provider recommendations are advisory only: the selected provider/model is never silently changed. Task history is bounded and excludes prompts, credentials, provider names, and hidden reasoning from room-visible events.

Each request carries a room-scoped conversation ID and task ID. Task state is server-validated through `queued`, `planning`, `running`, `waiting_for_approval`, `applying`, `validating`, and `completed`, with safe `cancelled`, `failed`, `timed_out`, and `conflict` terminal states. Reconnects replay bounded task history and ignore older out-of-order updates; duplicate task IDs are rejected instead of being run twice.

Validation is category-only (`typecheck`, `lint`, `tests`, or `build`) with fixed npm commands, `shell: false`, bounded output, a 30-second timeout, and a credential-sanitized child environment. The agent has no unrestricted shell, arbitrary command, browser, or operating-system file tool. Cancellation is propagated from the browser and the runtime has a 90-second overall deadline.

Validation reports `not-run`, `running`, `passed`, `failed`, `skipped`, `unavailable`, or `cancelled`. Because room files are virtual and are not materialized into a separate execution sandbox, automatic post-apply validation is skipped; explicit checks validate fixed backend workspace commands and do not execute arbitrary room code or claim that room code passed.

Monaco editor diagnostics are forwarded as bounded, structured, untrusted evidence with file and location metadata. If the external Programiz runner is opened, its stdout, stderr, timing, and exit code remain unavailable to the application; the agent is told that no execution result was provided rather than being given a fabricated result.

Tasks and proposals are room-scoped realtime state. Authorized collaborators receive the latest bounded task/proposal status on join or reconnect, while full patch content is fetched only through an authorized proposal endpoint when needed for approval. Task history is limited to 40 entries; agent memory is limited to ten entries per category and stores summaries, decisions, project facts, and validation outcomes—not secrets, raw repository dumps, access tokens, or hidden reasoning. “Continue task” retrieves the prior task summary and uses the current authoritative room version, so it never assumes that an earlier patch is still applicable.

## Code execution workflow

The workspace has two honest execution paths. `Run project` for virtual room source opens the language-matched external Programiz runner, with Copy and Download actions; the browser cannot read that external site's stdout, stderr, timing, or exit code, so the UI never fabricates a result. Separately, the server offers bounded fixed validation actions for the configured Code Collaborator project: tests, a safe existing server test target, build, TypeScript, ESLint, and diagnostics. These actions use `shell: false`, sanitized child environments, fixed commands, room authorization, cancellation, a 30–90 second bounded timeout, bounded output, and a 40-entry history. They do not execute arbitrary room code or accept command/path strings. Results are streamed over the existing Socket.IO room channel and are visible in the Terminal, Tests, Problems, and Output tabs.

## IDE workspace workflow

The room page keeps the top toolbar compact and places development controls in the activity bar and lower workspace panel. Explorer supports bounded shared file operations and protected-name checks; Search supports filename/content search across at most 500 indexed files and 20 results; the command palette exposes keyboard-friendly file, AI, Git, terminal, test, TypeScript, and lint actions; Problems can reveal a Monaco diagnostic and send it to Debug mode; and Source control can open the actual bounded Git diff for an AI review. Shared execution state, task history, and room/workspace authorization are restored on reconnect without duplicate events. Collaborator edits advance the authoritative version, so agent patches and Git synchronization must report conflicts instead of overwriting newer work.

## Documentation

- [Production deployment architecture, Vercel, backend, and Render](docs/DEPLOYMENT.md)
- [Environment variable reference](docs/ENVIRONMENT.md)
- [Production launch checklist](docs/LAUNCH_CHECKLIST.md)
- [Realtime load-test plan](docs/LOAD_TESTING.md)
- [Security policy](SECURITY.md)

## Notes

- The backend stores live room state in memory between persisted snapshots. Run one realtime backend instance unless a future Socket.IO adapter and shared-state design are added.
- `/health` reports that the backend process is alive. `/ready` reports safe feature availability plus optional persistence configuration/schema health without returning secret values.
- Guest-session signatures are tied to `GUEST_SESSION_SECRET`; changing that server secret invalidates existing guest sessions.
- Room authorization remains server-side even though identity is guest-first: signed room tokens, membership checks, socket binding, owner checks, rate limits, and payload validation are still enforced.

## Improvement Batch 1 workflow notes

The room UI keeps the top toolbar focused on project/room state and communication. Explorer, Search, Source Control, AI, Run & Debug, and the lower output views remain contextual workspace tools. The AI opens as a chat-first assistant with a small set of workflow starters; it can inspect the current file, diagnostics, bounded project context, and user-provided text attachments. Image attachments are shown for reference, but are preview-only until a configured provider advertises vision support.

Agent work is presented as human-readable progress: understanding context, inspecting relevant files, preparing a proposal, waiting for approval, and validating. Technical activity is available in an expandable detail section. Edit, Debug, refactor, test, and review flows never silently write files. A proposal shows affected files and line changes, then requires an explicit Apply or Reject action. If a collaborator changes a file first, the proposal becomes stale and offers Regenerate or Review current file without overwriting anyone's work.

Provider output is untrusted structured data. The server validates action, tool, patch, plan, diagnosis, and review schemas; deterministic JSON extraction is allowed only when safe. Malformed output is retried once with a stronger format instruction and then becomes a clear failure with no tool call or file change. Streaming agent events are validated again in the browser. Provider credentials remain on the backend, the selected provider is never silently changed, and the database-only guest architecture remains unchanged.
