import cors from "cors";
import express from "express";
import { env } from "./config/env";
import roomRoutes from "./routes/roomRoutes";

export const createApp = () => {
  const app = express();

  app.use(
    cors({
      origin: env.clientUrl
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true
    });
  });

  app.use("/api/rooms", roomRoutes);

  return app;
};
