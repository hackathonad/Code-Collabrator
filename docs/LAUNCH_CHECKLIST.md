# Manual launch checklist

1. Confirm `npm run verify` passes locally and CI is green.
2. Set the frontend API/socket URL to a deployed long-running backend; do not launch the Vercel frontend alone for room creation.
3. Check `/health` and `/ready` on the backend over HTTPS.
4. Apply all Supabase migrations and verify Auth site/redirect URLs, RLS, profiles, rooms/workspaces, and analytics tables.
5. In a regular window and an incognito window, create/join a room; verify editor sync, cursors, files, chat/typing, reconnect, reset, deletion, and Quick Rejoin cleanup.
6. Test sign-up/login, email confirmation behavior, refresh, profile, logout, and a guest room.
7. If configured, smoke-test AI, GitHub OAuth, LiveKit media, and analytics dashboard separately. Their absence must not block the workspace.
8. Review the Privacy and Terms pages, production metadata, current sitemap domain, and browser console for configuration errors.
9. Confirm no secrets are in Vercel `VITE_*` variables, tracked files, CI logs, or browser bundles. Rotate any credential ever exposed.
10. Decide on a license before public release; this repository currently has no license file.
