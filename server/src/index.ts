import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createApp, corsOptions } from "./app";
import { assertProductionEnvironment, env, environmentIssues, featureAvailability } from "./config/env";
import { clearCollaborationRuntime, registerCollaborationSocket } from "./sockets/collaborationSocket";

export const createRealtimeServer = () => {
  const app = createApp();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: corsOptions, maxHttpBufferSize: 1_000_000, transports: ["websocket", "polling"] });
  registerCollaborationSocket(io);
  return { app, httpServer, io };
};

const closeServer = async (httpServer: HttpServer, io: Server) => {
  await clearCollaborationRuntime();
  await new Promise<void>((resolve, reject) => {
    io.close(() => {
      if (!httpServer.listening) return resolve();
      httpServer.close((error) => error ? reject(error) : resolve());
    });
  });
};

export const startServer = () => {
  assertProductionEnvironment();
  const { httpServer, io } = createRealtimeServer();
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[shutdown] ${signal} received; closing realtime connections.`);
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    void closeServer(httpServer, io)
      .then(() => { clearTimeout(timeout); console.info("[shutdown] complete"); process.exit(0); })
      .catch((error) => { clearTimeout(timeout); console.error("[shutdown] failed", error instanceof Error ? error.message : "unknown error"); process.exit(1); });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  httpServer.listen(env.port, () => {
    const features = featureAvailability();
    console.info(`[startup] Code Collaborator backend listening on port ${env.port} (${env.nodeEnv}).`);
    console.info(`[startup] persistence=${features.persistence ? "configured" : "not configured"}; media=${features.media ? "configured" : "not configured"}; ai=${Object.values(features.ai).filter(Boolean).length} configured provider(s).`);
    if (environmentIssues.length) console.warn(`[startup] optional configuration warning(s): ${environmentIssues.join(" ")}`);
  });
  return { httpServer, io, shutdown };
};

if (require.main === module) startServer();
