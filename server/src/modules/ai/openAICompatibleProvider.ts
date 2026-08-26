import {
  AIProviderRequestError,
  AIProviderUnavailableError,
  type AICompletionRequest,
  type AICompletionResult,
  type AIProviderAdapter,
  type AIProviderDescriptor,
  type AIStreamEvent
} from "./aiTypes";
import { configuredModels, modelDescriptorsFromPayload, requestWithTimeout, streamResponseLines, usageFromOpenAI } from "./cloudProviderUtils";

type Descriptor = Omit<AIProviderDescriptor, "configured">;
type FetchImplementation = typeof fetch;

export interface OpenAICompatibleProviderOptions {
  id: "openai" | "openrouter";
  label: string;
  apiKey: string;
  defaultModel?: string;
  completionUrl: string;
  modelsUrl: string;
  catalog: Array<{ id: string; label: string }>;
  timeoutMs?: number;
  discoveryTtlMs?: number;
  fetchImplementation?: FetchImplementation;
  extraHeaders?: Record<string, string>;
}

interface CompatiblePayload {
  choices?: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: unknown;
}

export class OpenAICompatibleProvider implements AIProviderAdapter {
  readonly id: "openai" | "openrouter";
  readonly descriptor: Descriptor;
  private readonly label: string;
  private readonly apiKey: string;
  private readonly configuredDefaultModel: string;
  private readonly completionUrl: string;
  private readonly modelsUrl: string;
  private readonly catalog: Array<{ id: string; label: string }>;
  private readonly timeoutMs: number;
  private readonly discoveryTtlMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly extraHeaders: Record<string, string>;
  private activeModels: AIProviderDescriptor["models"];
  private activeDefaultModel: string | null;
  private cachedDescriptor: { expiresAt: number; value: Descriptor } | null = null;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    this.apiKey = options.apiKey.trim();
    this.configuredDefaultModel = options.defaultModel?.trim() ?? "";
    this.completionUrl = options.completionUrl;
    this.modelsUrl = options.modelsUrl;
    this.catalog = options.catalog;
    this.timeoutMs = Math.max(5_000, options.timeoutMs ?? 90_000);
    this.discoveryTtlMs = Math.max(1_000, options.discoveryTtlMs ?? 15_000);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.extraHeaders = options.extraHeaders ?? {};
    const models = configuredModels(this.configuredDefaultModel, this.catalog);
    this.activeModels = models.models;
    this.activeDefaultModel = models.defaultModel;
    this.descriptor = {
      id: this.id,
      name: this.id,
      label: this.label,
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

  async refreshDescriptor(): Promise<Descriptor> {
    if (this.cachedDescriptor && this.cachedDescriptor.expiresAt > Date.now()) return this.cachedDescriptor.value;
    if (!this.apiKey) return this.descriptor;
    try {
      const response = await requestWithTimeout(this.fetchImplementation, this.modelsUrl, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${this.apiKey}`, ...this.extraHeaders }
      }, this.timeoutMs, undefined, this.label);
      const payload = await response.json() as unknown;
      const models = modelDescriptorsFromPayload(payload, []);
      const descriptor: Descriptor = models.length
        ? { ...this.descriptor, available: true, health: "healthy", models, defaultModel: models.some((model) => model.id === this.configuredDefaultModel) ? this.configuredDefaultModel : models[0].id }
        : { ...this.descriptor, available: false, health: "no-models", models: [], defaultModel: null };
      this.activeModels = descriptor.models;
      this.activeDefaultModel = descriptor.defaultModel;
      this.cachedDescriptor = { expiresAt: Date.now() + this.discoveryTtlMs, value: descriptor };
      return descriptor;
    } catch {
      const fallback = configuredModels(this.configuredDefaultModel, this.catalog);
      const descriptor: Descriptor = { ...this.descriptor, available: false, health: "unavailable", ...fallback };
      this.activeModels = descriptor.models;
      this.activeDefaultModel = descriptor.defaultModel;
      this.cachedDescriptor = { expiresAt: Date.now() + this.discoveryTtlMs, value: descriptor };
      return descriptor;
    }
  }

  private modelFor(request: AICompletionRequest) {
    if (!this.apiKey) throw new AIProviderUnavailableError(this.id, `${this.label} is not configured on the server.`, "PROVIDER_NOT_CONFIGURED");
    const model = request.settings.model.trim() || this.activeDefaultModel;
    if (!model || !this.activeModels.some((entry) => entry.id === model)) {
      throw new AIProviderRequestError(`The selected ${this.label} model is not available.`, "MODEL_NOT_FOUND");
    }
    return model;
  }

  private async request(request: AICompletionRequest, stream: boolean) {
    const model = this.modelFor(request);
    const response = await requestWithTimeout(this.fetchImplementation, this.completionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}`, ...this.extraHeaders },
      body: JSON.stringify({ model, messages: request.messages, temperature: request.settings.temperature, max_tokens: request.settings.maxTokens, stream })
    }, this.timeoutMs, request.signal, this.label);
    return { model, response };
  }

  private text(payload: CompatiblePayload, streaming = false) {
    const value = streaming ? payload.choices?.[0]?.delta?.content : payload.choices?.[0]?.message?.content;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.flatMap((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : []).join("");
    return "";
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const { model, response } = await this.request(request, false);
    let payload: CompatiblePayload;
    try { payload = await response.json() as CompatiblePayload; } catch { throw new AIProviderRequestError(`${this.label} returned an invalid response.`, "PROVIDER_ERROR"); }
    const content = this.text(payload);
    if (!content.trim()) throw new AIProviderRequestError(`${this.label} returned an empty response.`, "PROVIDER_ERROR");
    const finishReason = payload.choices?.[0]?.finish_reason;
    return { content, provider: this.id, model, finishReason: typeof finishReason === "string" ? finishReason : undefined, usage: usageFromOpenAI(payload.usage) };
  }

  async *stream(request: AICompletionRequest): AsyncIterable<AIStreamEvent> {
    const { model, response } = await this.request(request, true);
    let content = "";
    let usage: ReturnType<typeof usageFromOpenAI>;
    let finishReason: string | undefined;
    for await (const line of streamResponseLines(response, this.label, request.signal)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") {
        if (!content) throw new AIProviderRequestError(`${this.label} returned an empty streaming response.`, "STREAM_ERROR");
        yield { type: "complete", result: { content, provider: this.id, model, finishReason: finishReason ?? "stop", usage } };
        return;
      }
      let payload: CompatiblePayload;
      try { payload = JSON.parse(data) as CompatiblePayload; } catch { throw new AIProviderRequestError(`${this.label} returned malformed streaming data.`, "STREAM_ERROR"); }
      const delta = this.text(payload, true);
      if (delta) { content += delta; yield { type: "delta", content: delta }; }
      const possibleReason = payload.choices?.[0]?.finish_reason;
      if (typeof possibleReason === "string") finishReason = possibleReason;
      usage = usageFromOpenAI(payload.usage) ?? usage;
    }
    if (!content) throw new AIProviderRequestError(`${this.label} returned an empty streaming response.`, "STREAM_ERROR");
    yield { type: "complete", result: { content, provider: this.id, model, finishReason: finishReason ?? "stop", usage } };
  }
}
