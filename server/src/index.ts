import { createServer } from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app";
import { env } from "./config/env";
import { registerCollaborationSocket } from "./sockets/collaborationSocket";

const app = createApp();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: env.clientUrl
  }
});

registerCollaborationSocket(io);

httpServer.listen(env.port, () => {
  console.log(`Server ready on http://localhost:${env.port}`);
});
