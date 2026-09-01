# Code Collaborator — Senior Architecture and Product Review

Review scope: the guest-first collaborative IDE, realtime room flows, AI teammate, workspace tools, persistence boundary, GitHub workflow, media workflow, and the current frontend/backend layout.

## Executive verdict

The product has a credible foundation for a guest-first collaborative coding workspace. The core loop is coherent: a guest creates or joins a room, edits a bounded virtual workspace, sees collaborators in realtime, chats, asks the coding assistant for help, reviews exact proposals, and explicitly applies approved changes.

The current codebase is already organized into the two requested application sections:

```text
client/                 Frontend: Vite, React, TypeScript, Tailwind, browser stores
  src/components/       UI and feature surfaces
  src/hooks/            Socket and lifecycle hooks
  src/lib/              Browser protocols, API clients, storage, media helpers
  src/pages/            Route-level screens
  src/store/            Browser state
  src/types/            Client contracts
  test/                 Client protocol and state tests

server/                 Backend: Express, Socket.IO, TypeScript, room authority
  src/routes/            HTTP APIs
  src/sockets/           Realtime room events
  src/modules/           Rooms, agent, AI, execution, GitHub, media
  src/services/          Persistence and external service boundaries
  test/                  Server integration and security tests

supabase/migrations/    Database-only schema history
docs/                   Deployment, environment, testing, and review documentation
```

Do not physically merge or rename these directories. They are the correct deployment boundary for Vercel and Render, and moving files would create import, build, and deployment risk without improving the user experience.

## What is strong today

- Guest access is immediate and consistent. Room membership is still server-authorized through signed guest sessions; Supabase Auth is not required.
- `roomStore` is the live authority for workspace files, code, chat, history, membership, ownership, and editor versions.
- Socket.IO is room-scoped and handles editor synchronization, workspace operations, presence, cursors, typing, chat, agent tasks, proposals, validation, Git state, and execution state.
- Agent work is bounded and proposal-first. Files are not changed until a collaborator explicitly applies a validated proposal.
- Multi-file patches are checked atomically against the current room version and exact expected contents. A collaborator edit makes a proposal stale instead of overwriting work.
- Shared activity and AI task state now give collaborators a common view of who is doing what, which file is active, what the assistant is investigating, and whether a proposal needs approval.
- Similar active tasks are detected before duplicate work starts. A collaborator can inspect the existing task or deliberately start another one.
- Activity, task notes, patch previews, diagnostics, and provider status are bounded and redacted before becoming room-visible.
- The client keeps the top toolbar focused on room and communication controls. Explorer, search, source control, run/debug, deployment, AI, and settings stay in their contextual surfaces.
- Provider keys, Supabase service credentials, GitHub tokens, LiveKit signing values, and guest-session secrets remain backend-only.

## User experience decisions

The room should feel like one workspace with a small number of clear surfaces:

1. The editor is the primary work area.
2. Chat opens by itself and contains only the room conversation.
3. Join call opens a separate call surface with join, participants, device controls, and leave-call actions.
4. The AI button is a single assistant entry point. The user types a natural request, optionally attaches files/images, and the server routes the work to the appropriate agent flow. Provider setup, shared task history, and technical details remain available but secondary.
5. People and Activity are separate collaboration views at the top of the right-side panel.
6. Deploy is explicit about its current capability: copy the room link, download source, and explain that a hosting provider must be connected. It must not imply that Vercel/Render deployment happened when no deployment integration exists.

This is a focused product model; another large visual rewrite is not needed before the next reliability milestone.

## Feature audit

| Area | Current assessment | Product decision |
| --- | --- | --- |
| Guest rooms | Working and consistent with the product identity | Keep; no Auth migration needed |
| Shared editor/workspace | Strong bounded virtual workspace with conflict protection | Keep and expand tests around large projects |
| Chat/presence/activity | Realtime, room-scoped, bounded, and useful for handoff | Keep; add durable history later if required |
| AI assistant | Multi-provider, chat-first, streamed, attachment-aware, proposal-gated | Keep; improve provider onboarding and model quality |
| AI teamwork | Shared tasks, ownership label, notes, deduplication, review/apply lifecycle | Keep; durable task recovery is the next backend step |
| Diagnostics/validation | Honest fixed validation and structured Monaco evidence | Keep; never execute arbitrary guest code on the server |
| Run project | Export/external-runner workflow | Keep the honest limitation; do not fake results |
| GitHub | Explicit server-token workflow with bounded import and non-force writes | Keep foundation; OAuth/per-user identity is a later product decision |
| Voice/video | Optional LiveKit with explicit join and device controls | Keep optional; do not mix it into chat |
| Deploy | Informational/export flow, not automatic hosting | Keep truthful until a provider integration is designed |
| Persistence | Room snapshots are persisted when Supabase is configured | Add task/activity durability only when restart recovery is a requirement |

## What is not needed now

- Supabase Auth, `auth.users`, `auth.uid()`, login, or signup. They conflict with the current guest-first experience and are not needed for room authorization.
- A new Supabase migration for the Batch 2 collaboration events. Activity is stored in the existing room snapshot JSON; task runtime state remains intentionally separate and in-memory.
- A second frontend or backend tree. The existing `client/` and `server/` workspaces are the correct split.
- Unrestricted shell execution, arbitrary host filesystem access, browser automation, or automatic patch application.
- Automatic Vercel/Render deployment from the room UI without first implementing provider authorization, deployment records, rollback, and audit requirements.
- A broad UI redesign that hides editor state or duplicates controls across the toolbar, activity bar, and panels.

## What is needed next

### Priority 1 — production reliability

- Persist room-scoped AI task summaries, statuses, notes, and proposal lifecycle metadata if tasks must survive a Render restart. The current task runtime is memory-backed and will be lost on process replacement.
- Add a shared Socket.IO adapter and a durable coordination strategy before running more than one backend instance.
- Add browser-level automated tests for desktop, 390px mobile, reconnect, chat-only open, call-only open, AI popup, stale patch, and deploy notification flows.
- Add an operational error boundary for persistence lag, provider outages, task timeouts, and reconnect recovery with traceable request IDs.

### Priority 2 — product usefulness

- Improve provider setup with a clear server configuration checklist and a test-connection action that reports only safe health metadata.
- Add real image understanding only when a selected provider advertises vision and the server path is designed for bounded, privacy-aware uploads. Until then, image attachments are correctly preview/reference-only.
- Add a lightweight shared task board view if teams need more than the current bounded queue, notes, and activity feed.
- Add real deployment integrations only after deciding whether deployment is per-room, per-guest, or connected to a team account.

### Priority 3 — scale and identity

- Decide whether guest identity is sufficient for the target audience. If accounts are introduced later, design a separate migration and threat model; do not quietly mix Auth into the current guest flow.
- Define quotas, retention, abuse controls, and audit policy for public rooms before making rooms permanent.
- Replace the deployment-token GitHub foundation with per-user OAuth only if users need their own GitHub permissions and attribution.

## Security and data boundaries

- The browser receives public API/socket URLs and safe provider capability metadata only.
- Supabase is database-only. The browser does not initialize a Supabase client.
- Server routes verify the signed guest token, room membership, room ID, workspace ID, and operation-specific permissions.
- Workspace tools use virtual room data and reject traversal, protected paths, oversized payloads, and secret-like content.
- Model output, repository content, chat, attachments, diagnostics, and validation output are untrusted data. They cannot grant permissions or change the tool policy.
- Proposals are exact, versioned, and explicit. Approval and application are separate events.
- The system should continue to prefer safe unavailability over claiming that a provider, runner, deployment, or validation succeeded when it did not.

## Final recommendation

Keep the current architecture and commit the collaboration improvements as one milestone. The app is ready for structured product QA and a real provider-backed pilot. The most valuable future work is durable task recovery, browser E2E coverage, provider onboarding, and a deliberate deployment/identity strategy—not authentication or another UI rewrite.
