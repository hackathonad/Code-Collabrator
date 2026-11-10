# Changelog

## Unreleased — M1: security and persistence foundation

Fixed
- The non-streaming agent endpoint cancelled itself about 1 ms after the request body was parsed (the request `close` event fires then on Node 16+), so a working provider always returned "Agent generation was cancelled" and early errors were swallowed, leaving the client hanging.

Security
- Capacity and abuse controls keyed by network, room, and a global daily AI budget (guest identities are free to mint): participant cap, room-creation and room-ID-guessing throttles, active-room cap, idle-room eviction.
- Session tokens are room-bound and expire; they travel in an `X-Guest-Token` header; a refresh endpoint keeps identities across expiry. Old-format and URL-borne tokens are accepted until 2026-12-10.
- New rooms use 12-character IDs (migration `202611100001`; 8-character IDs stay valid).
- One explicit role/permission matrix, enforced on the server, with a new read-only `viewer` role. **Behavior change:** AI patches can be approved only by the owner, moderators, members, or the person who requested the task.
- **Behavior change:** the shared GitHub token is ignored unless `GITHUB_SHARED_TOKEN_ENABLED=true` and is scoped by `GITHUB_ALLOWED_REPOS` (read-only, public-only without one). Connecting needs owner/moderator; remote writes need member or higher.
- **Behavior change:** server project checks (tests/build/lint) default off in production (`ENABLE_SERVER_PROJECT_CHECKS`). They ran the server's own repository, not the room's code.

Persistence
- AI tasks, patch proposals, and project memory are durable (migration `202611100002`) and restored when a room loads. Interrupted work is closed honestly after a restart.

Upgrade order: apply both migrations, then deploy the backend and frontend together. See docs/DEPLOYMENT.md.

## Unreleased — Launch hardening

- Added production configuration validation, health/readiness endpoints, strict origin handling, graceful shutdown, payload/workspace limits, and CI verification.
- Added launch-facing metadata, error/offline states, privacy and acceptable-use pages, deployment documentation, and a container-ready backend image.
- Preserved guest collaboration, database-only Supabase persistence, Socket.IO, optional AI/Ollama, GitHub, media, and analytics architecture.
