import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const DEVELOPMENT_GUEST_SECRET = "code-sphere-dev-guest-secret";
const LOCAL_CLIENT_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];
const DEPLOYED_CLIENT_ORIGINS = ["https://code-collabrator-client.vercel.app"];

type EnvironmentSource = NodeJS.ProcessEnv;

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
};

const toHttpUrl = (value: string | undefined, fallback = "") => {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.toString().replace(/\/+$/, "") : fallback;
  } catch {
    return fallback;
  }
};

const toLiveKitUrl = (value: string | undefined) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    return (url.protocol === "ws:" || url.protocol === "wss:") ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
};

const parseOrigins = (value: string | undefined, fallback: string[]) => {
  const candidates = String(value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  const origins = candidates.length ? candidates : fallback;
  return [...new Set(origins.map((origin) => toHttpUrl(origin)).filter(Boolean))];
};

export interface ServerEnvironment {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  port: number;
  clientUrl: string;
  clientOrigins: string[];
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiApiKey: string;
  geminiModel: string;
  groqApiKey: string;
  groqModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  openaiApiKey: string;
  openaiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  guestSessionSecret: string;
}

export interface ParsedEnvironment {
  config: ServerEnvironment;
  issues: string[];
}

/** Pure parser so production requirements can be verified without process mutation. */
export const parseServerEnvironment = (source: EnvironmentSource = process.env): ParsedEnvironment => {
  const nodeEnv = source.NODE_ENV === "production" ? "production" : source.NODE_ENV === "test" ? "test" : "development";
  const isProduction = nodeEnv === "production";
  const configuredClientUrl = toHttpUrl(source.CLIENT_URL);
  const config: ServerEnvironment = {
    nodeEnv,
    isProduction,
    port: toNumber(source.PORT, 4000),
    clientUrl: configuredClientUrl,
    clientOrigins: parseOrigins(source.CLIENT_URL, isProduction ? DEPLOYED_CLIENT_ORIGINS : LOCAL_CLIENT_ORIGINS),
    ollamaBaseUrl: toHttpUrl(source.OLLAMA_BASE_URL, "http://127.0.0.1:11434"),
    ollamaModel: source.OLLAMA_MODEL?.trim() ?? "",
    geminiApiKey: source.GEMINI_API_KEY?.trim() ?? "",
    geminiModel: source.GEMINI_MODEL?.trim() ?? "",
    groqApiKey: source.GROQ_API_KEY?.trim() ?? "",
    groqModel: source.GROQ_MODEL?.trim() ?? "",
    openrouterApiKey: source.OPENROUTER_API_KEY?.trim() ?? "",
    openrouterModel: source.OPENROUTER_MODEL?.trim() ?? "",
    openaiApiKey: source.OPENAI_API_KEY?.trim() ?? "",
    openaiModel: source.OPENAI_MODEL?.trim() ?? "",
    anthropicApiKey: source.ANTHROPIC_API_KEY?.trim() ?? "",
    anthropicModel: source.ANTHROPIC_MODEL?.trim() ?? "",
    livekitUrl: toLiveKitUrl(source.LIVEKIT_URL),
    livekitApiKey: source.LIVEKIT_API_KEY?.trim() ?? "",
    livekitApiSecret: source.LIVEKIT_API_SECRET?.trim() ?? "",
    // Browser VITE_* values are deliberately not accepted by the server. The
    // server must receive its own explicit Supabase configuration.
    supabaseUrl: toHttpUrl(source.SUPABASE_URL),
    supabaseServiceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
    guestSessionSecret: source.GUEST_SESSION_SECRET?.trim() || (isProduction ? "" : DEVELOPMENT_GUEST_SECRET),
  };

  const issues: string[] = [];
  if (isProduction && !config.clientOrigins.length) issues.push("CLIENT_URL must contain at least one HTTPS frontend origin in production.");
  if (isProduction && config.clientOrigins.some((origin) => !origin.startsWith("https://"))) issues.push("CLIENT_URL origins must use HTTPS in production.");
  if (isProduction && (!config.guestSessionSecret || config.guestSessionSecret === DEVELOPMENT_GUEST_SECRET || config.guestSessionSecret.length < 32)) {
    issues.push("GUEST_SESSION_SECRET must be a unique value of at least 32 characters in production.");
  }
  if (source.SUPABASE_SERVICE_ROLE_KEY && !config.supabaseUrl) issues.push("SUPABASE_URL is required when SUPABASE_SERVICE_ROLE_KEY is configured.");
  if (config.livekitApiKey || config.livekitApiSecret || config.livekitUrl) {
    if (!(config.livekitApiKey && config.livekitApiSecret && config.livekitUrl)) issues.push("LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be configured together.");
  }
  return { config, issues };
};

const parsedEnvironment = parseServerEnvironment();
export const env = parsedEnvironment.config;
export const environmentIssues = parsedEnvironment.issues;

export const assertProductionEnvironment = () => {
  if (env.isProduction && environmentIssues.length) {
    throw new Error(`Invalid production configuration:\n- ${environmentIssues.join("\n- ")}`);
  }
};

export const isAllowedClientOrigin = (origin: string | undefined) => {
  // Non-browser probes have no Origin header. Browser requests must match the
  // explicit allow-list; credentials are never enabled for this API.
  if (!origin) return true;
  return env.clientOrigins.includes(origin.replace(/\/+$/, ""));
};

export const featureAvailability = () => ({
  persistence: Boolean(env.supabaseUrl && env.supabaseServiceRoleKey),
  media: Boolean(env.livekitUrl && env.livekitApiKey && env.livekitApiSecret),
  ai: {
    ollama: Boolean(env.ollamaBaseUrl),
    gemini: Boolean(env.geminiApiKey),
    groq: Boolean(env.groqApiKey),
    openrouter: Boolean(env.openrouterApiKey),
    openai: Boolean(env.openaiApiKey),
    anthropic: Boolean(env.anthropicApiKey)
  }
});
