# Code Sphere

Code Sphere is a modern full-stack real-time collaborative coding platform built with React, Tailwind, Monaco Editor, Express, and Socket.io. It supports multiplayer rooms, live code sync, remote cursors, chat, role-aware collaboration, and an optional AI analysis layer.

## Stack

- Frontend: React + TypeScript + Vite + Tailwind + Monaco Editor
- Backend: Node.js + Express + TypeScript
- Real-time: Socket.io
- AI layer: OpenAI Responses API when `OPENAI_API_KEY` is configured, with a graceful fallback mode otherwise

## Project Structure

```text
.
|-- client
|   |-- src
|   |   |-- components
|   |   |-- hooks
|   |   |-- lib
|   |   |-- pages
|   |   |-- store
|   |   `-- types
|   |-- package.json
|   `-- vite.config.ts
|-- server
|   |-- src
|   |   |-- config
|   |   |-- constants
|   |   |-- modules
|   |   |-- routes
|   |   `-- sockets
|   `-- package.json
|-- package.json
`-- README.md
```

## Features

- Create and join rooms with unique IDs
- Live shared editor state for JavaScript, Python, and C++
- Remote cursors with usernames and active-line highlighting
- Participant list with roles: owner, editor, viewer
- Real-time room chat with timestamps
- AI actions: Predict Output and Explain Code
- Professional dark UI with responsive collaboration-focused layout

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create these files from the provided examples:

```bash
copy server\\.env.example server\\.env
copy client\\.env.example client\\.env
```

If you want real AI responses, set `OPENAI_API_KEY` inside `server/.env`.

## Run the app

From the repository root:

```bash
npm run dev
```

This starts:

- Backend on `http://localhost:4000`
- Frontend on `http://localhost:5173`

## Production build

```bash
npm run build
```

To run the backend build:

```bash
npm run start
```

## Notes

- Room state is currently stored in memory on the backend, which keeps the project simple and modular for local development.
- The AI layer analyzes code but does not execute it.
- Language switching currently resets the editor to that language's starter template.
- OpenAI requires outbound network access when AI actions are used.
