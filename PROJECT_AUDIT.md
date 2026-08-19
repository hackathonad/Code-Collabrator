# Project Audit — Code Collaborator

## 1. Tech Stack

### Frontend
- React 18 + TypeScript
- Vite
- Tailwind CSS
- Monaco Editor
- React Router
- Zustand for client state
- Socket.io client

### Backend
- Node.js
- Express + TypeScript
- Socket.io server
- REST room management routes

### Database
- Supabase is integrated as an optional persistence layer for profiles and room snapshots
- The app currently relies primarily on in-memory room state on the server

### Realtime
- Socket.io for room joins, editor sync, cursor presence, chat, typing indicators, and room controls

### Deployment
- Vercel-oriented deployment structure
- Local development runs Express + Vite separately
- Production deployment has shown routing/deployment issues during verification, including alias/deployment lookup problems

---

## 2. Folder Structure

```text
.
├── api/
│   ├── rooms/
│   │   ├── [roomId].ts
│   │   └── [roomId]/join.ts
│   ├── _lib/
│   │   └── roomStore.ts
│   ├── rooms.ts
│   └── index.ts
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── chat/
│   │   │   ├── editor/
│   │   │   ├── execution/
│   │   │   ├── history/
│   │   │   ├── insights/
│   │   │   ├── layout/
│   │   │   ├── sidebar/
│   │   │   └── ui/
│   │   ├── context/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── pages/
│   │   ├── store/
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts
├── server/
│   ├── src/
│   │   ├── app.ts
│   │   ├── config/
│   │   ├── constants/
│   │   ├── lib/
│   │   ├── modules/
│   │   ├── routes/
│   │   └── sockets/
│   └── package.json
├── package.json
├── README.md
├── vercel.json
└── PROJECT_AUDIT.md
```

---

## 3. Features

| Feature | Status | Notes |
|---|---|---|
| Authentication | 🟡 Partial | Supabase auth helpers exist, but the app does not expose a complete sign-in/sign-up flow in the UI |
| Room Creation | ✅ Complete | Users can create rooms with a chosen language |
| Room Joining | ✅ Complete | Rooms can be joined by room ID and saved session info |
| Collaborative Editor | ✅ Complete | Monaco-based shared editor with language switching and live updates |
| Cursor Sync | ✅ Complete | Cursor position is broadcast and rendered for remote users |
| Presence | ✅ Complete | Online/offline/idle/active participant state is tracked |
| Chat | ✅ Complete | Real-time room chat with typing indicators |
| Code Execution | 🟡 Partial | External runner integration exists, but it is not a full in-app execution environment |
| File Upload | ❌ Missing | No file upload or multi-file workspace support |
| Theme | ✅ Complete | Theme toggle and theme-aware UI are implemented |
| Mobile Support | 🟡 Partial | Responsive layout exists, but there is no dedicated mobile-first workflow or PWA support |

---

## 4. APIs

### REST Endpoints

- GET /health
  - Health check endpoint
- POST /api/rooms
  - Create a new room
- POST /api/rooms/:roomId/join
  - Join an existing room
- GET /api/rooms/:roomId
  - Fetch a room snapshot
- GET /api/rooms/:roomId/history
  - Fetch room history entries
- POST /api/rooms/:roomId/history/:historyId/restore
  - Restore a prior history entry
- DELETE /api/rooms/:roomId
  - Delete a room (owner only)

### Notes
- The Express server exposes these routes under the server runtime.
- Vercel-compatible API wrappers also exist under the api/ folder for deployment-style hosting.

---

## 5. Socket Events

### Client -> Server
- room:join
- editor:update
- editor:cursor
- editor:typing
- room:language
- chat:send
- chat:typing
- room:role
- room:pause
- room:restart
- room:delete

### Server -> Client
- room:snapshot
- room:participants
- presence:update
- cursor-update
- history:update
- chat:new
- chat:typing
- editor:typing
- editor:sync
- room:deleted
- room:error

### Internal Socket Lifecycle
- disconnect

---

## 6. Environment Variables

### Server
- PORT — server port (default: 4000)
- CLIENT_URL — allowed client origins for CORS
- OPENAI_API_KEY — optional AI integration key
- OPENAI_MODEL — optional AI model selection
- SUPABASE_URL — optional Supabase URL
- SUPABASE_SERVICE_ROLE_KEY — optional Supabase service-role key

### Client
- VITE_API_URL — API base URL
- VITE_SOCKET_URL — Socket.IO base URL
- VITE_SUPABASE_URL — optional Supabase client URL
- VITE_SUPABASE_ANON_KEY — optional Supabase anonymous key

---

## 7. Known TODOs

- Add persistent room storage beyond in-memory state so rooms survive server restarts and scale across instances
- Add real authentication and authorization instead of relying on client-supplied IDs
- Add file upload or multi-file workspace support
- Add testing coverage for REST and socket flows
- Add rate limiting and abuse protection
- Improve production deployment reliability for the hosted API path
- Expand mobile-specific UX and accessibility improvements

---

## 8. Build Errors

- No current build errors were detected.
- Verified by running: npm run build
- Result: server build passed and client build passed successfully

---

## 9. Runtime Errors

- No local build/runtime crash was observed during the latest local verification.
- During earlier deployment verification, the hosted Vercel path showed routing/deployment issues, including deployment lookup errors and join-route handling inconsistencies.
- The project is functional locally, but production deployment reliability still needs follow-up.

---

## 10. Security Concerns

- No strong authentication or authorization layer for room access
- Room actions rely on user identifiers supplied by the client, which can be spoofed
- Room ownership and role changes are not protected by a full auth model
- No explicit rate limiting or moderation controls
- Supabase service-role credentials are present in server configuration and should be kept strictly secret

---

## 11. Performance Concerns

- Room state is stored in memory, which is fine for local development but not ideal for production scale
- The app uses real-time socket broadcasts for every update, which can become chatty as participant count grows
- Large chat/history payloads can increase bandwidth and client memory usage over time
- Client-side Supabase sync calls may add latency and failure risk for every room update

---

## 12. Production Readiness Score

- Score: 74/100

### Rationale
- Strong real-time collaboration foundation and polished UI
- Good local build health and working core collaboration features
- Still needs stronger auth, persistence, deployment hardening, and testing before being considered fully production-ready
