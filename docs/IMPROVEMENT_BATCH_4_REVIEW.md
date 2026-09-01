# Improvement Batch 4 review — the “wow” layer

## Executive verdict

Code Collaborator now presents one coherent product loop: a guest-authorized room, a bounded project view, a shared editor, a real-time AI teammate, reviewable changes, validation evidence, and a Git handoff. The implementation extends the existing project index, agent runtime, task history, execution service, Git service, and room activity stream. It does not introduce a second assistant, a graph database, a project-management product, or a new authentication system.

The product promise is:

> A multiplayer development workspace where humans and AI coding agents work together on the same project.

## What is live

- Explorer has a compact Project snapshot. It is loaded from the authorized `/api/rooms/:roomId/project/experience` read model, which combines the bounded project index, actual fixed validation history, actual repository summary, available server-side AI providers, and room task state.
- The snapshot exposes framework/language, backend/database signals, entry points, important areas, test/config signals, AI context bounds, Git state, active tasks, health, and demo readiness. Missing evidence is shown as not run, attention, or unavailable rather than as a fabricated pass.
- Project map rows open indexed files and can ask the existing assistant about one area. “Understand project”, “Tour”, “What’s happening?”, “Session summary”, and “Handoff” are starter prompts into the existing agent flow.
- The AI assistant remains chat-first. New starters cover performance investigation, security review, test generation, documentation, project tour, and session summaries. Natural-language routing selects the existing Ask/Edit/Debug/Explain behavior.
- Shared AI tasks remain bounded to 40 per room. Tasks now carry presentation-only priority (`normal`, `high`, `urgent`), an optional room collaborator assignment, bounded watchers, affected file names, review-finding count, validation state, and a redacted result summary.
- Task priority, assignment, and watching use signed guest sessions, room membership checks, input bounds, and the existing rate limiter. They do not bypass approval, patch, execution, or authorization rules.
- Activity has bounded All/Humans/AI/Git/Tests filters. Repeated identical activity is deduplicated by the existing room store and messages are redacted before persistence/broadcast.
- Existing Problems → Debug with AI, Git diff → Review, issue → Analyze, patch review, explicit Apply/Reject, validation, and Socket.IO synchronization remain the contextual actions. No global toolbar was turned into a dashboard.
- Project memory remains visible, editable, removable, bounded, room/workspace-scoped, and untrusted. The current project index and verified checks take precedence when memory conflicts with repository evidence.

## Evidence and limits

The project experience does not read the host filesystem for a guest room. It reports only virtual workspace files that pass the existing safe-path rules, bounded index metadata, fixed validation records, repository state already held by the Git service, and safe provider descriptors. It never returns provider keys, GitHub tokens, Supabase credentials, raw hidden reasoning, or an entire repository dump.

Build, tests, TypeScript, and ESLint are “not run” until the corresponding fixed check has actually run. A Git health row is unavailable until a repository is connected. AI readiness is unavailable when no server-side provider has a discovered model. External Programiz execution remains intentionally unobservable; the product never invents its output.

The current task and project-experience stores are process-memory backed. Room snapshots persist collaboration state when Supabase is configured, but task ownership, watchers, and in-memory Git baselines still need a separately reviewed durable design if they must survive a Render restart.

## Product audit — keep, defer, or do not build

| Area | Decision | Reason |
| --- | --- | --- |
| Project onboarding, map, health, snapshot | Keep | Directly reinforces the project-room-AI loop and is grounded in actual state. |
| Debugging, review, test, refactor, docs, performance, security prompts | Keep | Reuses the one agent runtime and keeps changes proposal-first. |
| Shared task center, priority, assignment, watching, handoff | Keep, bounded | Useful multiplayer coordination without becoming a PM suite. |
| Activity filters and session/team summaries | Keep | Makes shared work legible with low notification volume. |
| Full code graph or graph database | Do not build | The bounded index and clickable areas answer navigation needs at lower cost. |
| Second AI/chat/agent subsystem | Do not build | It would split lifecycle, safety, provider, and approval behavior. |
| Supabase Auth, login, signup, `auth.users`, `auth.uid()` | Do not build | Guest signed sessions are the deliberate product model. |
| Automatic file edits, auto-commit, auto-push, or auto-deploy | Do not build | Human review and explicit Git/provider actions are part of the safety contract. |
| Arbitrary shell, package installation, or host-file access | Do not build | Fixed validation and virtual-workspace tools are the safe boundary. |
| Vision upload to AI | Defer | Current providers advertise no safe shipped vision path; images remain local reference previews. |
| Durable AI task database | Defer | Requires a schema and retention/authorization design; do not improvise it in the UI batch. |
| Multi-instance Socket.IO adapter | Defer | Requires shared room state and deployment coordination, not a client feature patch. |

## Security review

The existing guest token, room membership, workspace ID, safe path, secret-file, prompt-injection, fixed execution, rate-limit, and exact patch checks remain in the request path. Issue text, chat, memory, repository content, execution output, attachments, and AI responses remain untrusted. Task assignees are resolved only against current room participants. Priority is presentation/ordering metadata and is not used by authorization or queue safety. No browser Supabase client or provider credential was added.

## Verification plan

Regression coverage should keep the existing agent, collaboration, Git, execution, persistence, media, and production suites. Batch 4 adds project-experience evidence tests and task metadata tests. Final verification must include `npm run verify`, `git diff --check`, repository/client secret scans, guest/auth scan, localhost production-config scan, generated-artifact scan, and a manual room smoke test when a browser session is available.

## Recommended next milestone

Before adding more features, instrument real user sessions around “Understand project”, first successful AI task, proposal approval, validation, and Git handoff. The next high-value engineering work is durable task/proposal recovery and a safe multi-instance room architecture; neither should be hidden behind optimistic UI states.
