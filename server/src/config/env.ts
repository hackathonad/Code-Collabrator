import path from "node:path";
import dotenv from "dotenv";
import { parseRepoAllowlist } from "../modules/git/githubPolicy";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const DEVELOPMENT_GUEST_SECRET = "code-sphere-dev-guest-secret";
const LOCAL_CLIENT_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];
const DEPLOYED_CLIENT_ORIGINS = ["https://code-collabrator-client.vercel.app"];

type EnvironmentSource = NodeJS.ProcessEnv;

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
};
const toBoundedNumber = (value: string | undefined, fallback: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
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
  githubToken: string;
  githubSharedTokenEnabled: boolean;
  githubAllowedRepos: string[];
  serverProjectChecks: boolean;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  guestSessionSecret: string;
  apiRateLimit: number;
  aiRequestRateLimit: number;
  agentRequestRateLimit: number;
  agentPatchRateLimit: number;
  agentValidationRateLimit: number;
  githubApiRateLimit: number;
  gitWriteRateLimit: number;
  executionRateLimit: number;
  executionTimeoutMs: number;
  executionOutputLimit: number;
  executionMaxConcurrent: number;
  agentMaxIterations: number;
  agentMaxToolCalls: number;
  agentTimeoutMs: number;
  roomMaxParticipants: number;
  roomIdBytes: 4 | 6;
  maxActiveRooms: number;
  roomCreateRateLimit: number;
  roomMissRateLimit: number;
  roomIdleTtlMs: number;
  roomSweepIntervalMs: number;
  aiIpRateLimit: number;
  aiRoomRateLimit: number;
  aiGlobalDailyLimit: number;
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
    // GitHub credentials are server-only. They are intentionally not part of
    // featureAvailability or any API response.
    // A shared token gives every guest the token owner's GitHub access, so it is
    // ignored unless the operator explicitly opts in, and is then scoped by an allowlist.
    githubToken: source.GITHUB_SHARED_TOKEN_ENABLED === "true" ? source.GITHUB_TOKEN?.trim() ?? "" : "",
    githubSharedTokenEnabled: source.GITHUB_SHARED_TOKEN_ENABLED === "true",
    githubAllowedRepos: parseRepoAllowlist(source.GITHUB_ALLOWED_REPOS),
    // Fixed project checks run the server's own repository, not the room's code.
    // They default on for local development and off in production, where the
    // runtime image has no sources to check.
    serverProjectChecks: source.ENABLE_SERVER_PROJECT_CHECKS === "true" ? true : source.ENABLE_SERVER_PROJECT_CHECKS === "false" ? false : !isProduction,
    livekitUrl: toLiveKitUrl(source.LIVEKIT_URL),
    livekitApiKey: source.LIVEKIT_API_KEY?.trim() ?? "",
    livekitApiSecret: source.LIVEKIT_API_SECRET?.trim() ?? "",
    // Browser VITE_* values are deliberately not accepted by the server. The
    // server must receive its own explicit Supabase configuration.
    supabaseUrl: toHttpUrl(source.SUPABASE_URL),
    supabaseServiceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
    guestSessionSecret: source.GUEST_SESSION_SECRET?.trim() || (isProduction ? "" : DEVELOPMENT_GUEST_SECRET),
    apiRateLimit: toBoundedNumber(source.API_RATE_LIMIT, 180, 2_000),
    aiRequestRateLimit: toBoundedNumber(source.AI_REQUEST_RATE_LIMIT, 20, 200),
    agentRequestRateLimit: toBoundedNumber(source.AGENT_REQUEST_RATE_LIMIT, 12, 100),
    agentPatchRateLimit: toBoundedNumber(source.AGENT_PATCH_RATE_LIMIT, 20, 100),
    agentValidationRateLimit: toBoundedNumber(source.AGENT_VALIDATION_RATE_LIMIT, 8, 100),
    githubApiRateLimit: toBoundedNumber(source.GITHUB_API_RATE_LIMIT, 30, 200),
    gitWriteRateLimit: toBoundedNumber(source.GIT_WRITE_RATE_LIMIT, 12, 100),
    executionRateLimit: toBoundedNumber(source.EXECUTION_RATE_LIMIT, 10, 100),
    executionTimeoutMs: toBoundedNumber(source.EXECUTION_TIMEOUT_MS, 30_000, 90_000),
    executionOutputLimit: toBoundedNumber(source.EXECUTION_OUTPUT_LIMIT, 16_000, 24_000),
    executionMaxConcurrent: toBoundedNumber(source.EXECUTION_MAX_CONCURRENT, 2, 4),
    agentMaxIterations: toBoundedNumber(source.AGENT_MAX_ITERATIONS, 8, 8),
    agentMaxToolCalls: toBoundedNumber(source.AGENT_MAX_TOOL_CALLS, 20, 20),
    agentTimeoutMs: toBoundedNumber(source.AGENT_TIMEOUT_MS, 90_000, 90_000),
    // Capacity and abuse controls. Every value has a hard upper bound so a
    // mistaken deployment setting cannot silently remove the protection.
    roomMaxParticipants: toBoundedNumber(source.ROOM_MAX_PARTICIPANTS, 25, 100),
    // 6 bytes = 12 hex characters. Use 4 only until the room-id migration is applied to the database.
    roomIdBytes: source.ROOM_ID_BYTES === "4" ? 4 : 6,
    maxActiveRooms: toBoundedNumber(source.MAX_ACTIVE_ROOMS, 500, 5_000),
    roomCreateRateLimit: toBoundedNumber(source.ROOM_CREATE_RATE_LIMIT, 60, 1_000),
    roomMissRateLimit: toBoundedNumber(source.ROOM_MISS_RATE_LIMIT, 20, 300),
    roomIdleTtlMs: toBoundedNumber(source.ROOM_IDLE_TTL_MS, 86_400_000, 2_592_000_000),
    roomSweepIntervalMs: toBoundedNumber(source.ROOM_SWEEP_INTERVAL_MS, 300_000, 3_600_000),
    aiIpRateLimit: toBoundedNumber(source.AI_IP_RATE_LIMIT, 90, 1_000),
    aiRoomRateLimit: toBoundedNumber(source.AI_ROOM_RATE_LIMIT, 60, 1_000),
    aiGlobalDailyLimit: toBoundedNumber(source.AI_GLOBAL_DAILY_LIMIT, 5_000, 1_000_000)
  };

  const issues: string[] = [];
  if (isProduction && !config.clientOrigins.length) issues.push("CLIENT_URL must contain at least one HTTPS frontend origin in production.");
  if (isProduction && config.clientOrigins.some((origin) => !origin.startsWith("https://"))) issues.push("CLIENT_URL origins must use HTTPS in production.");
  if (isProduction && (!config.guestSessionSecret || config.guestSessionSecret === DEVELOPMENT_GUEST_SECRET || config.guestSessionSecret.length < 32)) {
    issues.push("GUEST_SESSION_SECRET must be a unique value of at least 32 characters in production.");
  }
  if (source.SUPABASE_SERVICE_ROLE_KEY && !config.supabaseUrl) issues.push("SUPABASE_URL is required when SUPABASE_SERVICE_ROLE_KEY is configured.");
  if (source.GITHUB_TOKEN?.trim() && !config.githubSharedTokenEnabled) issues.push("GITHUB_TOKEN is ignored unless GITHUB_SHARED_TOKEN_ENABLED=true.");
  if (config.githubSharedTokenEnabled && !config.githubAllowedRepos.length) issues.push("GITHUB_ALLOWED_REPOS is empty: GitHub is limited to read-only access to public repositories.");
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
  github: Boolean(env.githubToken),
  execution: env.serverProjectChecks,
  ai: {
    ollama: Boolean(env.ollamaBaseUrl),
    gemini: Boolean(env.geminiApiKey),
    groq: Boolean(env.groqApiKey),
    openrouter: Boolean(env.openrouterApiKey),
    openai: Boolean(env.openaiApiKey),
    anthropic: Boolean(env.anthropicApiKey)
  }
});
