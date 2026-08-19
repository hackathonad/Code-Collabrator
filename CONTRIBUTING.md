# Contributing

Use Node 22 or newer. Run `npm ci`, configure local environment files from the examples, then use `npm run dev` for the frontend and backend together. Before a pull request run `npm run verify`.

Keep changes focused, do not commit `.env` files or tokens, and preserve guest mode and realtime collaboration. Production changes must keep Vercel frontend-only and use a persistent Socket.IO backend. Report security issues through the process in `SECURITY.md` rather than public issue content.
