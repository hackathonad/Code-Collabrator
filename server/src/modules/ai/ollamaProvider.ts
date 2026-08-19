import {
  AICancelledError,
  AIProviderRequestError,
  AIProviderUnavailableError,
  type AICompletionRequest,
  type AICompletionResult,
  type AIProviderAdapter,
  type AIProviderDescriptor,
  type AIStreamEvent
} from "./aiTypes";

type ProviderDescriptor = Omit<AIProviderDescriptor, "configured">;
type FetchImplementation = typeof fetch;

interface OllamaProviderOptions {
  baseUrl: string;
  defaultModel?: string;
  timeoutMs?: number;
  discoveryTtlMs?: number;
  fetchImplementation?: FetchImplementation;
}

interface OllamaModelPayload {
  name?: unknown;
}

interface OllamaTagsPayload {
  models?: unknown;
}

interface OllamaChatPayload {
  message?: { content?: unknown };
  done?: unknown;
}

const normalizeBaseUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol");
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error("OLLAMA_BASE_URL must be a valid HTTP URL");
  }
};

const safeResponseMessage = (status: number) => status === 404
  ? "Ollama could not find the selected model. Pull it locally and try again."
  : status === 400
    ? "Ollama rejected this request. Check the selected model and try again."
    : "Ollama could not complete this request.";

export class OllamaProvider implements AIProviderAdapter {
  readonly id = "ollama" as const;
  readonly descriptor: ProviderDescriptor = {
    id: "ollama",
    label: "Ollama",
    available: false,
    health: "unavailable",
    supportsStreaming: true,
    supportsLocalModels: true,
    models: [],
    defaultModel: null
  };

  private readonly baseUrl: string;
  private readonly configuredDefaultModel: string;
  private readonly timeoutMs: number;
  private readonly discoveryTtlMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private cachedDescriptor: { expiresAt: number; value: ProviderDescriptor } | null = null;

  constructor(options: OllamaProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.configuredDefaultModel = options.defaultModel?.trim() ?? "";
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 30_000);
    this.discoveryTtlMs = Math.max(1_000, options.discoveryTtlMs ?? 10_000);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  private async request(path: string, init?: RequestInit, signal?: AbortSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      const response = await this.fetchImplementation(this.baseUrl + path, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
        signal: controller.signal
      });
      if (!response.ok) throw new AIProviderRequestError(safeResponseMessage(response.status));
      return response;
    } catch (error) {
      if (error instanceof AIProviderRequestError || error instanceof AICancelledError) throw error;
      if (signal?.aborted) throw new AICancelledError();
      if (error instanceof Error && error.name === "AbortError") {
        throw new AIProviderRequestError("Ollama did not respond before the request timed out.", "REQUEST_TIMEOUT");
      }
      throw new AIProviderUnavailableError("ollama", "Ollama is unavailable. Start the local Ollama server and try again.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async refreshDescriptor(): Promise<ProviderDescriptor> {
    if (this.cachedDescriptor && this.cachedDescriptor.expiresAt > Date.now()) return this.cachedDescriptor.value;
    let descriptor: ProviderDescriptor;
    try {
      const response = await this.request("/api/tags");
      const payload = await response.json() as OllamaTagsPayload;
      if (!Array.isArray(payload.models)) throw new AIProviderRequestError("Ollama returned an invalid model list.");
      const models = payload.models.flatMap((model) => {
        const name = model && typeof model === "object" ? (model as OllamaModelPayload).name : "";
        return typeof name === "string" && name.trim() ? [{ id: name.trim(), label: name.trim() }] : [];
      });
      const defaultModel = models.some((model) => model.id === this.configuredDefaultModel)
        ? this.configuredDefaultModel
        : models[0]?.id ?? null;
      descriptor = {
        ...this.descriptor,
        available: models.length > 0,
        health: models.length > 0 ? "healthy" : "no-models",
        models,
        defaultModel
      };
    } catch {
      descriptor = {
        ...this.descriptor,
        available: false,
        health: "unavailable",
        models: [],
        defaultModel: null
      };
    }
    this.cachedDescriptor = { expiresAt: Date.now() + this.discoveryTtlMs, value: descriptor };
    return descriptor;
  }

  private async resolveModel(request: AICompletionRequest) {
    const descriptor = await this.refreshDescriptor();
    if (descriptor.health === "unavailable") {
      throw new AIProviderUnavailableError("ollama", "Ollama is unavailable. Start the local Ollama server and try again.");
    }
    if (!descriptor.models.length) {
      throw new AIProviderUnavailableError("ollama", "Ollama is running, but no local models are installed. Pull a model and try again.");
    }
    const model = request.settings.model || descriptor.defaultModel;
    if (!model || !descriptor.models.some((entry) => entry.id === model)) {
      throw new AIProviderRequestError("The selected Ollama model is not installed.");
    }
    return model;
  }

  private requestBody(request: AICompletionRequest, model: string, stream: boolean) {
    return JSON.stringify({
      model,
      messages: request.messages,
      stream,
      options: {
        temperature: request.settings.temperature,
        num_predict: request.settings.maxTokens
      }
    });
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const model = await this.resolveModel(request);
    const response = await this.request("/api/chat", {
      method: "POST",
      body: this.requestBody(request, model, false)
    }, request.signal);
    let payload: OllamaChatPayload;
    try {
      payload = await response.json() as OllamaChatPayload;
    } catch {
      throw new AIProviderRequestError("Ollama returned an invalid response.");
    }
    const content = payload.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new AIProviderRequestError("Ollama returned an empty response.");
    return { content, provider: "ollama", model, finishReason: payload.done === true ? "stop" : undefined };
  }

  async *stream(request: AICompletionRequest): AsyncIterable<AIStreamEvent> {
    const model = await this.resolveModel(request);
    const response = await this.request("/api/chat", {
      method: "POST",
      body: this.requestBody(request, model, true)
    }, request.signal);
    const reader = response.body?.getReader();
    if (!reader) throw new AIProviderRequestError("Ollama did not provide a streaming response.");
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: OllamaChatPayload;
          try { event = JSON.parse(line) as OllamaChatPayload; } catch { throw new AIProviderRequestError("Ollama returned malformed streaming data."); }
          const delta = event.message?.content;
          if (typeof delta === "string" && delta) {
            content += delta;
            yield { type: "delta", content: delta };
          }
          if (event.done === true) {
            yield { type: "complete", result: { content, provider: "ollama", model, finishReason: "stop" } };
            return;
          }
        }
      }
      if (!content) throw new AIProviderRequestError("Ollama returned an empty streaming response.");
      yield { type: "complete", result: { content, provider: "ollama", model, finishReason: "stop" } };
    } finally {
      reader.releaseLock();
    }
  }
}

export const createOllamaProvider = (options: OllamaProviderOptions) => new OllamaProvider(options);
