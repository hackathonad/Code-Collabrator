import {
  AIProviderRequestError,
  AIProviderUnavailableError,
  type AICompletionRequest,
  type AICompletionResult,
  type AIProviderAdapter,
  type AIProviderDescriptor,
  type AIStreamEvent
} from "./aiTypes";
import { configuredModels, modelDescriptorsFromPayload, requestWithTimeout, streamResponseLines } from "./cloudProviderUtils";

type Descriptor = Omit<AIProviderDescriptor, "configured">;
interface AnthropicProviderOptions { apiKey: string; defaultModel?: string; timeoutMs?: number; fetchImplementation?: typeof fetch; }
interface AnthropicPayload { content?: Array<{ type?: unknown; text?: unknown }>; stop_reason?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown }; }
const catalog = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet" },
  { id: "claude-3-5-haiku-20241022", label: "Claude Haiku" }
];

const usage = (value: AnthropicPayload["usage"]) => {
  const promptTokens = typeof value?.input_tokens === "number" ? value.input_tokens : undefined;
  const completionTokens = typeof value?.output_tokens === "number" ? value.output_tokens : undefined;
  if (promptTokens === undefined && completionTokens === undefined) return undefined;
  return { promptTokens, completionTokens, totalTokens: promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined };
};

export class AnthropicProvider implements AIProviderAdapter {
  readonly id = "anthropic" as const;
  readonly descriptor: Descriptor;
  private readonly apiKey: string;
  private readonly configuredDefaultModel: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private activeModels: Descriptor["models"];
  private activeDefaultModel: string | null;
  private cachedDescriptor: { expiresAt: number; value: Descriptor } | null = null;

  constructor(options: AnthropicProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.configuredDefaultModel = options.defaultModel?.trim() ?? "";
    this.timeoutMs = Math.max(5_000, options.timeoutMs ?? 90_000);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    const models = configuredModels(this.configuredDefaultModel, catalog);
    this.activeModels = models.models;
    this.activeDefaultModel = models.defaultModel;
    this.descriptor = {
      id: "anthropic",
      name: "anthropic",
      label: "Anthropic",
      available: false,
      health: this.apiKey ? "unavailable" : "not-configured",
      capabilities: ["chat", "streaming"],
      supportsStreaming: true,
      supportsToolCalling: false,
      supportsVision: false,
      supportsLocalModels: false,
      ...models
    };
  }

  isConfigured = () => Boolean(this.apiKey);

  private headers = () => ({ "Content-Type": "application/json", Accept: "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" });

  async refreshDescriptor(): Promise<Descriptor> {
    if (this.cachedDescriptor && this.cachedDescriptor.expiresAt > Date.now()) return this.cachedDescriptor.value;
    if (!this.apiKey) return this.descriptor;
    try {
      const response = await requestWithTimeout(this.fetchImplementation, "https://api.anthropic.com/v1/models", { method: "GET", headers: this.headers() }, this.timeoutMs, undefined, "Anthropic");
      const payload = await response.json() as unknown;
      const models = modelDescriptorsFromPayload(payload, []);
      const descriptor: Descriptor = models.length
        ? { ...this.descriptor, available: true, health: "healthy", models, defaultModel: models.some((model) => model.id === this.configuredDefaultModel) ? this.configuredDefaultModel : models[0].id }
        : { ...this.descriptor, available: false, health: "no-models", models: [], defaultModel: null };
      this.activeModels = descriptor.models;
      this.activeDefaultModel = descriptor.defaultModel;
      this.cachedDescriptor = { expiresAt: Date.now() + 15_000, value: descriptor };
      return descriptor;
    } catch {
      const fallback = configuredModels(this.configuredDefaultModel, catalog);
      const descriptor: Descriptor = { ...this.descriptor, available: false, health: "unavailable", ...fallback };
      this.activeModels = descriptor.models;
      this.activeDefaultModel = descriptor.defaultModel;
      this.cachedDescriptor = { expiresAt: Date.now() + 15_000, value: descriptor };
      return descriptor;
    }
  }

  private modelFor(request: AICompletionRequest) {
    if (!this.apiKey) throw new AIProviderUnavailableError("anthropic", "Anthropic is not configured on the server.", "PROVIDER_NOT_CONFIGURED");
    const model = request.settings.model.trim() || this.activeDefaultModel;
    if (!model || !this.activeModels.some((entry) => entry.id === model)) throw new AIProviderRequestError("The selected Anthropic model is not available.", "MODEL_NOT_FOUND");
    return model;
  }

  private body(request: AICompletionRequest, model: string, stream: boolean) {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    return JSON.stringify({ model, max_tokens: request.settings.maxTokens, temperature: request.settings.temperature, stream, ...(system ? { system } : {}), messages: request.messages.filter((message) => message.role !== "system") });
  }

  private async request(request: AICompletionRequest, stream: boolean) {
    const model = this.modelFor(request);
    const response = await requestWithTimeout(this.fetchImplementation, "https://api.anthropic.com/v1/messages", { method: "POST", headers: this.headers(), body: this.body(request, model, stream) }, this.timeoutMs, request.signal, "Anthropic");
    return { model, response };
  }

  private text(payload: AnthropicPayload) { return payload.content?.flatMap((part) => part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("") ?? ""; }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const { model, response } = await this.request(request, false);
    let payload: AnthropicPayload;
    try { payload = await response.json() as AnthropicPayload; } catch { throw new AIProviderRequestError("Anthropic returned an invalid response.", "PROVIDER_ERROR"); }
    const content = this.text(payload);
    if (!content.trim()) throw new AIProviderRequestError("Anthropic returned an empty response.", "PROVIDER_ERROR");
    return { content, provider: "anthropic", model, finishReason: typeof payload.stop_reason === "string" ? payload.stop_reason : undefined, usage: usage(payload.usage) };
  }

  async *stream(request: AICompletionRequest): AsyncIterable<AIStreamEvent> {
    const { model, response } = await this.request(request, true);
    let content = "";
    let stopReason: string | undefined;
    let streamUsage: ReturnType<typeof usage>;
    for await (const line of streamResponseLines(response, "Anthropic", request.signal)) {
      if (line.startsWith("event:")) continue;
      if (!line.startsWith("data:")) continue;
      let payload: AnthropicPayload & { type?: unknown; delta?: { type?: unknown; text?: unknown }; message?: { usage?: AnthropicPayload["usage"] } };
      try { payload = JSON.parse(line.slice(5).trim()) as typeof payload; } catch { throw new AIProviderRequestError("Anthropic returned malformed streaming data.", "STREAM_ERROR"); }
      const delta = payload.delta?.type === "text_delta" && typeof payload.delta.text === "string" ? payload.delta.text : "";
      if (delta) { content += delta; yield { type: "delta", content: delta }; }
      if (payload.type === "message_delta") {
        stopReason = typeof (payload.delta as { stop_reason?: unknown }).stop_reason === "string" ? (payload.delta as { stop_reason: string }).stop_reason : stopReason;
      }
      streamUsage = usage(payload.usage) ?? usage(payload.message?.usage) ?? streamUsage;
    }
    if (!content) throw new AIProviderRequestError("Anthropic returned an empty streaming response.", "STREAM_ERROR");
    yield { type: "complete", result: { content, provider: "anthropic", model, finishReason: stopReason ?? "stop", usage: streamUsage } };
  }
}

export const createAnthropicProvider = (options: AnthropicProviderOptions) => new AnthropicProvider(options);
