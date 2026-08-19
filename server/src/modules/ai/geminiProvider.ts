import { AIProviderRequestError, AIProviderUnavailableError, type AICompletionRequest, type AICompletionResult, type AIProviderAdapter, type AIProviderDescriptor, type AIStreamEvent } from "./aiTypes";
import { configuredModels, linesFromChunk, requestWithTimeout } from "./cloudProviderUtils";

type Descriptor = Omit<AIProviderDescriptor, "configured">;
interface GeminiProviderOptions { apiKey: string; defaultModel?: string; timeoutMs?: number; fetchImplementation?: typeof fetch; }
interface GeminiPayload { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>; }
const catalog = [{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }];

export class GeminiProvider implements AIProviderAdapter {
  readonly id = "gemini" as const;
  readonly descriptor: Descriptor;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.timeoutMs = Math.max(5_000, options.timeoutMs ?? 90_000);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    const models = configuredModels(options.defaultModel?.trim() ?? "", catalog);
    this.descriptor = { id: "gemini", label: "Gemini", available: Boolean(this.apiKey), health: this.apiKey ? "healthy" : "not-configured", supportsStreaming: true, supportsLocalModels: false, ...models };
  }

  isConfigured = () => Boolean(this.apiKey);
  async refreshDescriptor() { return this.descriptor; }
  private modelFor(request: AICompletionRequest) {
    if (!this.apiKey) throw new AIProviderUnavailableError("gemini", "Gemini is not configured on this server.", "PROVIDER_NOT_CONFIGURED");
    const model = request.settings.model || this.descriptor.defaultModel;
    if (!model || !this.descriptor.models.some((entry) => entry.id === model)) throw new AIProviderRequestError("The selected Gemini model is unavailable.", "MODEL_UNAVAILABLE");
    return model;
  }
  private body(request: AICompletionRequest) {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    return JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: request.messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
      generationConfig: { temperature: request.settings.temperature, maxOutputTokens: request.settings.maxTokens }
    });
  }
  private async request(request: AICompletionRequest, stream: boolean) {
    const model = this.modelFor(request);
    const operation = stream ? "streamGenerateContent?alt=sse&key=" : "generateContent?key=";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${operation}${encodeURIComponent(this.apiKey)}`;
    const response = await requestWithTimeout(this.fetchImplementation, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: this.body(request) }, this.timeoutMs, request.signal, "Gemini");
    return { model, response };
  }
  private content(payload: GeminiPayload, requireContent = true) {
    const content = payload.candidates?.[0]?.content?.parts?.map((part) => typeof part.text === "string" ? part.text : "").join("") ?? "";
    if (requireContent && !content.trim()) throw new AIProviderRequestError("Gemini returned an empty response.");
    return content;
  }
  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const { model, response } = await this.request(request, false);
    let payload: GeminiPayload;
    try { payload = await response.json() as GeminiPayload; } catch { throw new AIProviderRequestError("Gemini returned an invalid response."); }
    return { content: this.content(payload), provider: "gemini", model, finishReason: "stop" };
  }
  async *stream(request: AICompletionRequest): AsyncIterable<AIStreamEvent> {
    const { model, response } = await this.request(request, true);
    const reader = response.body?.getReader();
    if (!reader) throw new AIProviderRequestError("Gemini did not provide a streaming response.", "STREAM_FAILED");
    const decoder = new TextDecoder(); let buffer = ""; let content = "";
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }); const parsed = linesFromChunk(buffer); buffer = parsed.remainder;
        for (const line of parsed.complete) {
          if (!line.startsWith("data:")) continue;
          let payload: GeminiPayload; try { payload = JSON.parse(line.slice(5).trim()) as GeminiPayload; } catch { throw new AIProviderRequestError("Gemini returned malformed streaming data.", "STREAM_FAILED"); }
          const delta = this.content(payload, false);
          if (delta) { content += delta; yield { type: "delta", content: delta }; }
        }
      }
      if (!content) throw new AIProviderRequestError("Gemini returned an empty streaming response.", "STREAM_FAILED");
      yield { type: "complete", result: { content, provider: "gemini", model, finishReason: "stop" } };
    } finally { reader.releaseLock(); }
  }
}
export const createGeminiProvider = (options: GeminiProviderOptions) => new GeminiProvider(options);
