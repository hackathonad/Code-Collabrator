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
| `GITHUB_TOKEN` | Server | Optional | Server-side GitHub token used for explicitly connected guest-room project operations. OAuth is not enabled. | No |
| `EXECUTION_RATE_LIMIT` | Server | Optional | Per-room guest-session rate limit for safe validation starts per minute; defaults to `10` and is capped at `100`. | No |
| `EXECUTION_TIMEOUT_MS` | Server | Optional | Safe validation timeout; defaults to `30,000` ms and is capped at `90,000` ms. | No |
| `EXECUTION_OUTPUT_LIMIT` | Server | Optional | Maximum combined stdout/stderr retained per execution; defaults to `16,000` and is capped at `24,000` characters. | No |
| `EXECUTION_MAX_CONCURRENT` | Server | Optional | Maximum concurrent fixed validation processes for one backend; defaults to `2` and is capped at `4`. | No |
| `LIVEKIT_URL` | Server | Optional; all three LiveKit values are required together | Public `ws:`/`wss:` media endpoint. | No |
| `LIVEKIT_API_KEY` | Server | Optional; all three LiveKit values are required together | LiveKit signing credential. | No |
| `LIVEKIT_API_SECRET` | Server | Optional; all three LiveKit values are required together | LiveKit signing credential. | No |

Agent safety limits are configurable on the server and remain bounded even when environment values are malformed or too large: `API_RATE_LIMIT` (default 180, maximum 2,000), `AI_REQUEST_RATE_LIMIT` (20, maximum 200), `AGENT_REQUEST_RATE_LIMIT` (12, maximum 100), `AGENT_PATCH_RATE_LIMIT` (20, maximum 100), and `AGENT_VALIDATION_RATE_LIMIT` (8, maximum 100) are per-minute limits. GitHub project operations use `GITHUB_API_RATE_LIMIT` (30, maximum 200) and `GIT_WRITE_RATE_LIMIT` (12, maximum 100), keyed by room and guest session. `AGENT_MAX_ITERATIONS` (8), `AGENT_MAX_TOOL_CALLS` (20), and `AGENT_TIMEOUT_MS` (90,000) can only be lowered within their hard safety bounds.

Supabase is database-only in this product. There are no browser Supabase variables and no Supabase Auth session requirement. If persistence is disabled or unavailable, the server keeps rooms in memory and `/ready` reports `persistence.configured`, `persistence.healthy`, and a generic status without exposing provider details to the browser.

Improvement Batch 4 does not add an environment variable. The project snapshot endpoint derives its read-only overview from the authorized virtual workspace, bounded project index, fixed execution history, current Git service state, safe provider descriptors, and room-scoped AI task state. Build, tests, TypeScript, ESLint, Git, AI, and demo-readiness rows remain honest when a check, provider, or repository has not been run or configured. Do not add a browser Supabase client or provider credentials to support these surfaces.

The current client intentionally does not read `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`; do not add them to the frontend. Browser-local state is limited to signed guest sessions, Quick Rejoin, cached room snapshots, themes, and AI settings/conversations. Socket IDs, presence, cursors, typing state, and provider credentials are never stored there.

## Coding-agent runtime

The agent is enabled by the existing AI provider configuration; it does not require a new environment variable. Requests run on the backend against the authoritative guest-authorized room workspace and include a bounded room/editor snapshot, project index, ranked relevant files, structured Monaco diagnostics when available, and only a small recent collaboration context. The runtime supports Ask, Edit, Debug, and Explain modes, thirteen bounded virtual-workspace tools, streamed activity events, structured reviews and diagnoses, room-scoped task history, and approval-gated exact single- or multi-file patches. Proposals are tied to a base editor version and become stale after any intervening room edit. It never uses Supabase Auth or browser Supabase credentials.

Validation tools use fixed npm categories (`typecheck`, `lint`, `tests`, `build`) plus an existing server test-file target, `shell: false`, bounded output, and the configured hard timeout. Results are normalized as queued, running, passed, failed, timed out, unavailable, or cancelled. The child process environment removes variables whose names indicate API keys, secrets, tokens, passwords, Supabase, or guest-session credentials. Validation is an explicit user action and does not auto-apply a proposal. Virtual room source is never passed to the server command runner; the Run project action remains an honest external-runner/export flow. Do not add provider credentials to client variables or include secrets in workspace files.

## IDE workspace and safe execution

The room page provides a bounded IDE surface: activity-bar access to Explorer, Search, Source control, AI, and Run & Debug; shared folders/files with create, rename, move, duplicate, trash/restore, and protected-name checks; tabs and breadcrumbs; content and filename search; a command palette; Monaco diagnostics; collaborator presence; and compact output tabs for Terminal, Tests, Problems, and Output. The top room toolbar remains focused on room and communication controls.

Safe execution is server-controlled and room-authorized. Only fixed project checks, TypeScript, ESLint, diagnostics, all-tests, and an existing `server/test/*.test.cjs` target can start. Requests never accept a shell string, arbitrary executable, arbitrary path, package installation, network command, destructive Git action, or host filesystem path. Every execution is room/workspace scoped, deduplicated by request ID, bounded to a 40-entry history, capped by timeout/output/concurrency limits, cancellable, and synchronized over Socket.IO. A new collaborator receives the latest bounded history after joining.

The browser cannot execute virtual room source inside the backend. `Run project` reports that limitation and offers the language-matched external runner, copy, and download actions. External runner stdout, stderr, timing, and exit code are not observable cross-origin and are never fabricated or sent to the agent. Diagnostics and observed fixed-check output can be sent to the AI as bounded untrusted evidence.

Agent requests use a bounded conversation/task continuity hint and server-issued room-scoped lifecycle state. The browser may keep recent conversations locally for guest continuity, while task history remains bounded and excludes raw prompts, provider/model details, credentials, and hidden reasoning from room-visible events. Refreshing the provider catalog never silently changes the selected provider; choose a replacement explicitly when the current provider is unavailable.

The Phase 6F index cache is limited to 100 room/workspace entries and invalidates on content or workspace-structure changes. Each index is capped at 500 files, 20 ranked relevant files, and bounded symbols/imports/summaries. Debug diagnoses are limited to eight hypotheses per response with five short evidence items each. Active-agent cancellation is server-aware, room deletion aborts related work, task timers close orphaned nonterminal tasks, and pre-cancelled validation exits before creating a child process. `/ready` reports backend, persistence, provider, and agent readiness without exposing credentials; configured but unhealthy persistence returns a non-ready status.

`SUPABASE_JWT_SECRET` and `PISTON_URL` are not read by the current source and are not deployment requirements. OpenAI, Anthropic, and OpenRouter credentials are read only by the server-side AI adapters.

## GitHub project workflow

Set `GITHUB_TOKEN` only on the persistent backend when repository workflows are wanted. The token is never accepted from the browser, returned by an API, stored in localStorage, or broadcast over Socket.IO. A guest explicitly connects GitHub inside the Source control panel, then selects a repository and branch. Imported text files are copied into the existing bounded virtual workspace (maximum 500 files and 4 MB); secret-like files, binary files, and oversized files are excluded.

The workflow exposes repository metadata, branch listing, working-tree status, staged changes, bounded diffs, branch creation, branch switching with unsaved-change protection, commit planning, non-force push, safe pull/fast-forward, and pull-request creation. Commit, push, branch creation, branch switching, pull, and PR creation are explicit user actions; the AI can analyze or suggest text but cannot perform them silently. GitHub API errors, rate limits, remote-ahead state, and invalid paths are normalized.

Batch 3 adds a read-only open-issue list for a connected repository. Selecting **Analyze** prepares an untrusted issue-text prompt in the existing AI assistant; the user still submits the task and must review any resulting proposal. No issue text is promoted to trusted instructions, and the server does not create, edit, close, or comment on issues. No new environment variable is required.

This deployment uses a server-configured token foundation rather than OAuth. It is suitable for a trusted deployment token and repositories that token may access, but it is not per-guest GitHub identity. Do not place a personal token in a client variable. Project metadata and the room workspace are persisted through the existing room snapshot when Supabase is enabled; the in-memory Git baseline is rebuilt by re-importing after a backend restart. No GitHub migration is applied automatically.

The agent receives bounded Git status/diff metadata through the existing room context engine. Repository content is untrusted data and is never treated as instructions. The GitHub adapter only calls the fixed `https://api.github.com` origin; arbitrary remotes, shell Git, force-push, deletion, and history rewriting are not exposed.

## AI provider setup

The implemented adapters are Ollama, Gemini, Groq, OpenRouter, OpenAI, and Anthropic. Provider credentials and upstream URLs stay on the persistent backend; no AI secret belongs in a `VITE_*` variable. The cloud adapters discover models through their provider model endpoints and cache the result briefly. For local development, run `ollama serve`, pull a model such as `qwen3.5:latest`, and leave `OLLAMA_MODEL` blank to select the first discovered model (or set it to an installed model name). The client reads only the safe provider catalog from `GET /api/ai/providers`. A provider is shown as not configured, unavailable, or available; unavailable providers cannot send requests, while rooms, editing, chat, and Socket.IO remain usable.

## Product-quality workflow behavior

The assistant is chat-first. Its compact workflow starters route natural-language requests to the existing Ask, Edit, Debug, or Explain agent modes. The panel exposes only bounded context summaries and human-readable lifecycle status in the main view; tool activity and other technical details are expandable. Text attachments are clipped before they reach the provider, image attachments are preview-only because the current providers do not advertise vision support, and attachments are labeled as untrusted reference content.

Model responses are untrusted and pass runtime schema validation before the agent can act. Invalid plans, diagnoses, reviews, tool calls, patch arguments, and streamed events are rejected. A malformed structured response receives one deterministic repair/retry request; a second failure produces `INVALID_MODEL_OUTPUT`, no tool call, no proposal, and no workspace change. All edits remain exact, approval-gated proposals tied to the current room version. Refreshing the provider list preserves the selected provider and reports its health instead of silently switching to another provider.

## Shared collaboration and AI teammate

Room presence, active-file labels, activity entries, shared AI task summaries, and task notes use the existing guest session and room authorization. They do not add Supabase Auth, `auth.users`, `auth.uid()`, login, or signup. Activity is bounded to 60 entries and redacted before it is emitted or written into the existing room snapshot settings JSON. Task history is bounded to 40 entries in the running backend process; task prompts, provider credentials, provider/model names, and hidden reasoning are not room-visible.

The assistant can receive bounded text-file reference content and local image previews. Images are not sent to a provider unless a future server path explicitly supports safe vision uploads; the current UI correctly describes them as reference-only. A task note is a short collaborator handoff, not a command to the agent. Similar active tasks are detected per room and require an explicit start-anyway choice.

The current task/activity runtime is memory-backed. Supabase room snapshots preserve the room workspace and bounded activity when configured, but they do not yet provide durable AI task recovery after a Render process restart. If restart-safe task ownership, notes, and proposal history are required, that should be implemented as a reviewed database design rather than by exposing provider or guest credentials.

Task priority, assignment, and watching are bounded room controls, not security controls. Assignees must be current room participants; watchers and notes are clipped and redacted. Priority only changes presentation and never bypasses agent limits, patch approval, validation, Git authorization, or room isolation.
