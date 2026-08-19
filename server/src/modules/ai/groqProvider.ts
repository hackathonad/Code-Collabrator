import { AIProviderRequestError, AIProviderUnavailableError, type AICompletionRequest, type AICompletionResult, type AIProviderAdapter, type AIProviderDescriptor, type AIStreamEvent } from "./aiTypes";
import { configuredModels, linesFromChunk, requestWithTimeout } from "./cloudProviderUtils";

type Descriptor = Omit<AIProviderDescriptor, "configured">;
interface GroqProviderOptions { apiKey: string; defaultModel?: string; timeoutMs?: number; fetchImplementation?: typeof fetch; }
interface GroqPayload { choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown }; finish_reason?: unknown }>; }
const catalog = [{ id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { id: "qwen-qwq-32b", label: "Qwen QwQ 32B" }, { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill" }];

export class GroqProvider implements AIProviderAdapter {
  readonly id = "groq" as const;
  readonly descriptor: Descriptor;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  constructor(options: GroqProviderOptions) {
    this.apiKey = options.apiKey.trim(); this.timeoutMs = Math.max(5_000, options.timeoutMs ?? 90_000); this.fetchImplementation = options.fetchImplementation ?? fetch;
    const models = configuredModels(options.defaultModel?.trim() ?? "", catalog);
    this.descriptor = { id: "groq", label: "Groq", available: Boolean(this.apiKey), health: this.apiKey ? "healthy" : "not-configured", supportsStreaming: true, supportsLocalModels: false, ...models };
  }
  isConfigured = () => Boolean(this.apiKey);
  async refreshDescriptor() { return this.descriptor; }
  private modelFor(request: AICompletionRequest) {
    if (!this.apiKey) throw new AIProviderUnavailableError("groq", "Groq is not configured on this server.", "PROVIDER_NOT_CONFIGURED");
    const model = request.settings.model || this.descriptor.defaultModel;
    if (!model || !this.descriptor.models.some((entry) => entry.id === model)) throw new AIProviderRequestError("The selected Groq model is unavailable.", "MODEL_UNAVAILABLE");
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
    return { content, provider: "groq", model, finishReason: typeof finishReason === "string" ? finishReason : undefined };
  }
  async *stream(request: AICompletionRequest): AsyncIterable<AIStreamEvent> {
    const { model, response } = await this.request(request, true); const reader = response.body?.getReader();
    if (!reader) throw new AIProviderRequestError("Groq did not provide a streaming response.", "STREAM_FAILED");
    const decoder = new TextDecoder(); let buffer = ""; let content = "";
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }); const parsed = linesFromChunk(buffer); buffer = parsed.remainder;
        for (const line of parsed.complete) {
          if (!line.startsWith("data:")) continue; const data = line.slice(5).trim(); if (data === "[DONE]") { yield { type: "complete", result: { content, provider: "groq", model, finishReason: "stop" } }; return; }
          let payload: GroqPayload; try { payload = JSON.parse(data) as GroqPayload; } catch { throw new AIProviderRequestError("Groq returned malformed streaming data.", "STREAM_FAILED"); }
          const delta = this.text(payload, true); if (delta) { content += delta; yield { type: "delta", content: delta }; }
        }
      }
      if (!content) throw new AIProviderRequestError("Groq returned an empty streaming response.", "STREAM_FAILED");
      yield { type: "complete", result: { content, provider: "groq", model, finishReason: "stop" } };
    } finally { reader.releaseLock(); }
  }
}
export const createGroqProvider = (options: GroqProviderOptions) => new GroqProvider(options);
