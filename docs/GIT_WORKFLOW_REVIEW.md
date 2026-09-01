# Improvement Batch 3: Git, GitHub, and AI workflow review

Status: implemented on top of the existing guest-first collaboration architecture.

## Executive assessment

Code Collaborator now has a coherent virtual-workspace development loop: a guest joins a room, optionally connects the deployment's server-side GitHub integration, imports a bounded repository branch, edits collaboratively, inspects a real before/after diff, asks the existing agent to review or explain it, turns a finding into a user-submitted task, reviews a proposal, applies it only after approval, runs fixed validation, prepares a commit, and explicitly pushes or creates a pull request.

The repository already had a clean physical split: `client/` is the Vite/React frontend and `server/` is the Express/Socket.IO backend. Moving files into new frontend/backend folders would add risk without improving ownership, so Batch 3 keeps that structure and makes the shared workflow clearer at its existing boundaries.

This is a server-configured GitHub token foundation, not per-user OAuth. It is appropriate for a trusted deployment token and bounded repository workflows. It is not yet a complete multi-user Git hosting integration. The limitations below are intentional and should remain visible to users.

## Capability matrix

| Area | Current behavior | Assessment |
| --- | --- | --- |
| Project onboarding | Project card shows repository, branch, local change count, sync state, and explanatory message. **Understand project** uses the existing bounded index/context engine. | Complete for the current virtual-workspace model. |
| Repository connection | Explicit guest-session connection, repository search/selection, metadata, branch list, loading/error/retry, disconnect, and truthful unavailable state. | Complete, with deployment-token identity documented. |
| Branches | Current branch is visible; branch list, create, and switch are available. Switch requires confirmation and stops when local changes exist. | Safe and usable. |
| Source control | One collapsible panel owns changes, staged state, actual diff, history, commit preparation, sync, PR, and issue entry points. | Complete for the supported GitHub workflow. |
| Diff | Bounded multi-file before/after content, status, additions, deletions, staged state, current branch, and remote comparison support. | Complete; no fabricated diff or line locations. |
| AI review | Review requests include the actual server-derived diff plus bounded project context. Findings are structured by severity and can omit location when evidence is unavailable. | Complete and advisory. |
| Review → task | A finding's **Investigate** action prepares Debug/fix context in the existing agent. Proposal, review, approval, apply, and validation remain separate. | Complete without a second agent architecture. |
| Commit | Stage/unstage, edit a message, prepare a bounded commit plan, then confirm push separately. | Complete; the UI does not claim that preparation is a commit. |
| AI commit message | Suggests a subject/body from actual diff, branch, and recent commit context. The user edits it before preparation. | Complete and non-authoritative. |
| History | Imported recent history and locally pushed commit summaries show message, author, time, SHA, and known changed files. | Complete within bounded history; per-commit remote diff opening is not a separate view yet. |
| Sync | `clean`, `ahead`, `behind`, `diverged`, `offline`, and `unavailable` are represented with explanations. Remote head is checked through the fixed GitHub API. | Complete for fast-forward safety. |
| Push | Explicit, non-force Git Data API write; remote head is rechecked before blobs/tree/commit/ref update. Auth, rate-limit, remote-ahead, and network failures are normalized. | Safe for the shared deployment-token model. |
| Pull | Explicit fast-forward import; local changes block the operation. | Safe, but intentionally not a merge engine. |
| Conflict handling | Diverged state is shown and blocks unsafe pull/push; AI can explain the state using bounded evidence. | Safe baseline; true three-way conflict resolution is not enabled. |
| PR | Explicit title/body form, branch defaults, AI summary, recent PR list, confirmation, and normalized failure states. | Complete for PR creation. |
| Issues | Connected repositories expose a bounded read-only open-issue list. **Analyze** prepares an untrusted issue prompt in the existing agent; it does not auto-submit or write to GitHub. | Safe initial issue → AI task handoff. |
| Project memory | Inspectable, editable room-scoped project facts; ten entries per category, 320-character summaries, redaction, and delete. | Complete for bounded non-secret memory. |
| Collaboration | Git state is refreshed through room events; activity remains room-scoped and safe summaries avoid credentials. | Complete within the single backend instance model. |

## End-to-end workflow

```text
User request
  → bounded project/index context
  → plan or diagnosis
  → relevant files and actual diff
  → proposal/review
  → explicit approval
  → atomic room apply
  → fixed validation
  → diff review
  → AI commit/PR draft
  → explicit commit/push/PR action
```

The agent never receives permission from provider output. Repository files, issue text, chat, diagnostics, and remote responses are untrusted evidence. Edit proposals carry room/workspace identity, expected content, base editor version, and stable patch identity; stale or conflicting proposals are rejected rather than overwriting a collaborator.

## Security and isolation assessment

- Guest sessions are signed and checked for every room route. GitHub connections are keyed by `roomId:userId`; project baselines are keyed by `roomId:workspaceId`.
- GitHub credentials and AI credentials are read only by the server. They are not returned in status responses, browser storage, Socket.IO events, or client bundles.
- GitHub requests use the fixed `https://api.github.com` origin. Repository owner/name, branch, blob SHA, and workspace paths are validated. Secret-like, VCS-control, binary, and oversized files are excluded from import/staging.
- No shell Git, arbitrary remote, force push, branch deletion, history rewrite, package installation, arbitrary command, or host filesystem access is exposed.
- Git writes are explicit and rate-limited. Push rechecks the remote branch head and uses `force: false` semantics. Pull and branch switching stop when local changes exist.
- Issue and repository text cannot override server rules. Issue analysis is a prompt handoff, not an implicit execution permission.
- Supabase remains database-only. There is no Supabase Auth, `auth.users`, `auth.uid()`, login, signup, or browser Supabase client in this workflow.

## What is intentionally not needed now

- A second Git service or a physical checkout per room. The existing bounded virtual workspace is the right fit for guest collaboration.
- OAuth or account login for this milestone. Adding it would change the product security model and is outside the guest-first requirement.
- Automatic Vercel/Render deployment from the Deploy panel. Deployment needs provider authorization, job records, logs, rollback, and audit controls first.
- Automatic merges, rebases, conflict resolutions, force pushes, or silent pull behavior.

## Recommended next work

1. Replace the deployment-wide GitHub token with an explicit per-user OAuth/app installation model if independent GitHub identity and authorization are required.
2. Add a true three-way comparison/merge service with local/remote/base panes, conflict-file records, proposal-only AI resolution, and dedicated regression tests before enabling conflict resolution.
3. Persist Git project baseline, staged state, and history in a dedicated database model if restart-safe project sessions are required; currently the room snapshot persists workspace content, while the in-memory Git baseline must be re-imported after backend restart.
4. Add remote diff links and commit selection only after the API can provide bounded, authorized commit contents without leaking repository data across rooms.
5. Add issue comments/creation only with explicit user controls, audit events, and a clear authorization model; the current read-only issue browser is the safer default.
6. Add browser automation at a CI-capable environment for the 390/768/1024/1280 acceptance matrix. Local/API tests are strong, but visual browser smoke is environment-dependent.

## Verification evidence

Batch 3 adds focused regression coverage for actual before/after diff evidence, multi-file changed-file history, bounded/redacted project-memory API behavior, guest authorization, and read-only issue normalization. Run from the repository root:

```bash
npm run verify
git diff --check
```

The final release report should record the server/client test totals produced by the current run, build and lint status, secret/auth/generated-artifact scans, browser-smoke availability, the exact commit hash, and whether `origin/main` matches local `HEAD`.
