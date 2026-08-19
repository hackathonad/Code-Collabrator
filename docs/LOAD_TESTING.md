# Realtime load-test plan

Use a non-production environment and the existing Socket.IO integration test as the baseline. Before increasing limits, manually test 10 then 25 concurrent guest participants in a room:

1. Join/rejoin all participants and confirm no duplicate presence rows.
2. Send rapid editor updates, cursor moves, typing changes, and chat messages for five minutes.
3. Create, rename, move, and delete files concurrently; confirm invalid conflicts are rejected and workspace snapshots stay coherent.
4. Restart the backend and confirm clients reconnect to the persisted room snapshot. Expect transient in-memory presence/cursor state to reset.
5. Test a room deletion while participants are connected and confirm local Quick Rejoin entries disappear.

The current guardrails are 1 MB HTTP/socket payloads, 500 KB individual code updates, 1,000 files, 500 folders, 32 folder levels, 4 MB total workspace content, 100 chat entries, 30 history entries, and 20 AI requests per room participant per minute. These are safety bounds, not scalability guarantees.
