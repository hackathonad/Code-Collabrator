import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import { env, featureAvailability, isAllowedClientOrigin } from "./config/env";
import { aiService } from "./modules/ai/aiService";
import { createOllamaProvider } from "./modules/ai/ollamaProvider";
import { createGeminiProvider } from "./modules/ai/geminiProvider";
import { createGroqProvider } from "./modules/ai/groqProvider";
import { createOpenRouterProvider } from "./modules/ai/openrouterProvider";
import { createOpenAIProvider } from "./modules/ai/openaiProvider";
import { createAnthropicProvider } from "./modules/ai/anthropicProvider";
import roomRoutes from "./routes/roomRoutes";
import aiRoutes from "./routes/aiRoutes";
import agentRoutes from "./routes/agentRoutes";
import mediaRoutes from "./routes/mediaRoutes";
import { roomPersistence } from "./services/roomPersistence";

const API_RATE_LIMIT_WINDOW_MS = 60_000;
const API_RATE_LIMIT_MAX_REQUESTS = env.apiRateLimit;
const apiRateLimit = new Map<string, { startedAt: number; count: number }>();

const apiLimiter: express.RequestHandler = (request, response, next) => {
  const now = Date.now();
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const current = apiRateLimit.get(key);
  if (!current || now - current.startedAt > API_RATE_LIMIT_WINDOW_MS) apiRateLimit.set(key, { startedAt: now, count: 1 });
  else {
    current.count += 1;
    if (current.count > API_RATE_LIMIT_MAX_REQUESTS) {
      response.status(429).json({ ok: false, message: "Too many requests. Please wait a moment and try again." });
      return;
    }
  }
  if (apiRateLimit.size > 5_000) for (const [rateKey, entry] of apiRateLimit) if (now - entry.startedAt > API_RATE_LIMIT_WINDOW_MS) apiRateLimit.delete(rateKey);
  next();
};

export const corsOptions: cors.CorsOptions = {
  origin(origin, callback) { callback(null, isAllowedClientOrigin(origin)); },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: false,
  maxAge: 86_400
};

export const createApp = () => {
  const app = express();
  app.disable("x-powered-by");
  aiService.registerProvider(createOllamaProvider({ baseUrl: env.ollamaBaseUrl, defaultModel: env.ollamaModel }));
  aiService.registerProvider(createGeminiProvider({ apiKey: env.geminiApiKey, defaultModel: env.geminiModel }));
  aiService.registerProvider(createGroqProvider({ apiKey: env.groqApiKey, defaultModel: env.groqModel }));
  aiService.registerProvider(createOpenRouterProvider({ apiKey: env.openrouterApiKey, defaultModel: env.openrouterModel }));
  aiService.registerProvider(createOpenAIProvider({ apiKey: env.openaiApiKey, defaultModel: env.openaiModel }));
  aiService.registerProvider(createAnthropicProvider({ apiKey: env.anthropicApiKey, defaultModel: env.anthropicModel }));
  app.set("trust proxy", 1);
  app.use((request, response, next) => {
    response.setHeader("X-Request-Id", randomUUID());
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "geolocation=(), payment=(), usb=()");
    next();
  });
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "1mb", strict: true }));
  app.get("/health", (_request, response) => response.json({ ok: true, service: "code-collaborator", timestamp: new Date().toISOString() }));
  app.get("/ready", async (_request, response) => {
    const persistence = await roomPersistence.checkReadiness();
    const providers = aiService.getProviders().map(({ id, label, configured, available, health, models, defaultModel, capabilities, supportsStreaming, supportsToolCalling }) => ({ id, label, configured, available, health, models, defaultModel, capabilities, supportsStreaming, supportsToolCalling }));
    const persistenceReady = !persistence.configured || persistence.healthy;
    response.status(persistenceReady ? 200 : 503).json({
      ok: persistenceReady,
      service: "code-collaborator",
      backend: { healthy: true },
      persistence,
      ai: { healthy: providers.some((provider) => provider.available), providers },
      agent: { available: true, limits: { maxIterations: env.agentMaxIterations, maxToolCalls: env.agentMaxToolCalls, timeoutMs: env.agentTimeoutMs } },
      features: featureAvailability()
    });
  });
  app.use("/api", apiLimiter);
  app.use("/api", mediaRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/ai", agentRoutes);
  app.use("/api/rooms", roomRoutes);
  app.use("/api", (_request, response) => response.status(404).json({ ok: false, message: "API route not found." }));
  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) return next(error);
    const malformedJson = error instanceof SyntaxError && "body" in error;
    response.status(malformedJson ? 400 : 500).json({ ok: false, message: malformedJson ? "Malformed JSON request body." : "Unexpected server error." });
  });
  return app;
};
