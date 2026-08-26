import { AIProviderRequestError, AIProviderUnavailableError, type AICompletionRequest, type AICompletionResult, type AIProviderAdapter, type AIProviderDescriptor, type AIStreamEvent } from "./aiTypes";
import { configuredModels, linesFromChunk, modelDescriptorsFromPayload, requestWithTimeout, usageFromOpenAI } from "./cloudProviderUtils";

type Descriptor = Omit<AIProviderDescriptor, "configured">;
interface GroqProviderOptions { apiKey: string; defaultModel?: string; timeoutMs?: number; fetchImplementation?: typeof fetch; }
interface GroqPayload { choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown }; finish_reason?: unknown }>; usage?: unknown; }
const catalog = [{ id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { id: "qwen-qwq-32b", label: "Qwen QwQ 32B" }, { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill" }];

export class GroqProvider implements AIProviderAdapter {
  readonly id = "groq" as const;
  readonly descriptor: Descriptor;
  private readonly apiKey: string;
  private readonly configuredDefaultModel: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private activeModels: Descriptor["models"];
  private activeDefaultModel: string | null;
  constructor(options: GroqProviderOptions) {
    this.apiKey = options.apiKey.trim(); this.configuredDefaultModel = options.defaultModel?.trim() ?? ""; this.timeoutMs = Math.max(5_000, options.timeoutMs ?? 90_000); this.fetchImplementation = options.fetchImplementation ?? fetch;
    const models = configuredModels(this.configuredDefaultModel, catalog);
    this.activeModels = models.models; this.activeDefaultModel = models.defaultModel;
    this.descriptor = { id: "groq", name: "groq", label: "Groq", available: false, health: this.apiKey ? "unavailable" : "not-configured", capabilities: ["chat", "streaming"], supportsStreaming: true, supportsToolCalling: false, supportsVision: false, supportsLocalModels: false, ...models };
  }
  isConfigured = () => Boolean(this.apiKey);
  async refreshDescriptor() {
    if (!this.apiKey) return this.descriptor;
    try {
      const response = await requestWithTimeout(this.fetchImplementation, "https://api.groq.com/openai/v1/models", { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${this.apiKey}` } }, this.timeoutMs, undefined, "Groq");
      const payload = await response.json() as unknown;
      const models = modelDescriptorsFromPayload(payload, []);
      this.activeModels = models;
      this.activeDefaultModel = models.some((model) => model.id === this.configuredDefaultModel) ? this.configuredDefaultModel : models[0]?.id ?? null;
      return { ...this.descriptor, available: Boolean(models.length), health: models.length ? "healthy" as const : "no-models" as const, models, defaultModel: this.activeDefaultModel };
    } catch {
      const models = configuredModels(this.configuredDefaultModel, catalog);
      this.activeModels = models.models; this.activeDefaultModel = models.defaultModel;
      return { ...this.descriptor, available: false, health: "unavailable" as const, ...models };
    }
  }
  private modelFor(request: AICompletionRequest) {
    if (!this.apiKey) throw new AIProviderUnavailableError("groq", "Groq is not configured on this server.", "PROVIDER_NOT_CONFIGURED");
    const model = request.settings.model || this.activeDefaultModel;
    if (!model || !this.activeModels.some((entry) => entry.id === model)) throw new AIProviderRequestError("The selected Groq model is unavailable.", "MODEL_NOT_FOUND");
    return model;
  }
  private async request(request: AICompletionRequest, stream: boolean) {
    const model = this.modelFor(request);
    const response = await requestWithTimeout(this.fetchImplementation, "https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model, messages: request.messages, temperature: request.settings.temperature, max_tokens: request.settings.maxTokens, stream })
    }, this.timeoutMs, request.signal, "Groq");
    return { model, response };
  }
  private text(payload: GroqPayload, streaming = false) {
    const value = streaming ? payload.choices?.[0]?.delta?.content : payload.choices?.[0]?.message?.content;
    return typeof value === "string" ? value : "";
  }
  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const { model, response } = await this.request(request, false); let payload: GroqPayload;
    try { payload = await response.json() as GroqPayload; } catch { throw new AIProviderRequestError("Groq returned an invalid response."); }
    const content = this.text(payload); if (!content.trim()) throw new AIProviderRequestError("Groq returned an empty response.");
    const finishReason = payload.choices?.[0]?.finish_reason;
    return { content, provider: "groq", model, finishReason: typeof finishReason === "string" ? finishReason : undefined, usage: usageFromOpenAI(payload.usage) };
  }
  async *stream(request: AICompletionRequest): AsyncIterable<AIStreamEvent> {
    const { model, response } = await this.request(request, true); const reader = response.body?.getReader();
    if (!reader) throw new AIProviderRequestError("Groq did not provide a streaming response.", "STREAM_ERROR");
    const decoder = new TextDecoder(); let buffer = ""; let content = ""; let usage: ReturnType<typeof usageFromOpenAI>;
    try {
      const consume = (line: string) => {
        if (!line.startsWith("data:")) return { delta: "", done: false };
        const data = line.slice(5).trim(); if (data === "[DONE]") return { delta: "", done: true };
        let payload: GroqPayload; try { payload = JSON.parse(data) as GroqPayload; } catch { throw new AIProviderRequestError("Groq returned malformed streaming data.", "STREAM_ERROR"); }
        usage = usageFromOpenAI(payload.usage) ?? usage;
        return { delta: this.text(payload, true), done: false };
      };
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }); const parsed = linesFromChunk(buffer); buffer = parsed.remainder;
        for (const line of parsed.complete) { const event = consume(line); if (event.delta) { content += event.delta; yield { type: "delta", content: event.delta }; } if (event.done) { yield { type: "complete", result: { content, provider: "groq", model, finishReason: "stop" } }; return; } }
      }
      buffer += decoder.decode();
      const finalEvent = consume(buffer); if (finalEvent.delta) { content += finalEvent.delta; yield { type: "delta", content: finalEvent.delta }; } if (finalEvent.done) { yield { type: "complete", result: { content, provider: "groq", model, finishReason: "stop" } }; return; }
      if (!content) throw new AIProviderRequestError("Groq returned an empty streaming response.", "STREAM_ERROR");
      yield { type: "complete", result: { content, provider: "groq", model, finishReason: "stop", usage } };
    } finally { reader.releaseLock(); }
  }
}
export const createGroqProvider = (options: GroqProviderOptions) => new GroqProvider(options);
