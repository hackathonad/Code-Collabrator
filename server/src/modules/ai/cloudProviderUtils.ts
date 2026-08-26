import { AICancelledError, AIProviderRequestError, type AIErrorCode, type AIModelDescriptor, type AIUsageMetadata } from "./aiTypes";

export const configuredModels = (defaultModel: string, catalog: Array<{ id: string; label: string }>) => {
  const models = defaultModel && !catalog.some((model) => model.id === defaultModel)
    ? [{ id: defaultModel, label: defaultModel }, ...catalog]
    : catalog;
  return { models, defaultModel: defaultModel && models.some((model) => model.id === defaultModel) ? defaultModel : models[0]?.id ?? null };
};

export const providerErrorForStatus = (provider: string, status: number) => {
  const details: Record<number, [string, AIErrorCode]> = {
    400: [`${provider} rejected this request. Check the selected model and try again.`, "INVALID_REQUEST"],
    401: [`${provider} authentication failed. Check the server configuration.`, "PROVIDER_ERROR"],
    403: [`${provider} authentication failed. Check the server configuration.`, "PROVIDER_ERROR"],
    404: [`The selected ${provider} model is unavailable.`, "MODEL_NOT_FOUND"],
    408: [`${provider} did not respond in time. Please try again.`, "TIMEOUT"],
    429: [`${provider} rate limit reached. Try again later.`, "RATE_LIMITED"]
  };
  const [message, code] = details[status] ?? [`${provider} could not complete this request.`, "PROVIDER_ERROR"];
  return new AIProviderRequestError(message, code);
};

export const requestWithTimeout = async (
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  provider: string
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetchImplementation(input, { ...init, signal: controller.signal });
    if (!response.ok) throw providerErrorForStatus(provider, response.status);
    return response;
  } catch (error) {
    if (error instanceof AIProviderRequestError) throw error;
    if (signal?.aborted) throw new AICancelledError();
    if (error instanceof Error && error.name === "AbortError") {
      throw new AIProviderRequestError(`${provider} did not respond before the request timed out.`, "TIMEOUT");
    }
    throw new AIProviderRequestError(`Unable to reach ${provider}. Please try again.`, "PROVIDER_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
};

export const linesFromChunk = (buffer: string) => {
  const lines = buffer.split("\n");
  return { complete: lines.slice(0, -1), remainder: lines.at(-1) ?? "" };
};

export const modelDescriptorsFromPayload = (
  payload: unknown,
  fallback: AIModelDescriptor[] = [],
  nameTransform: (value: string) => string = (value) => value
) => {
  const data = payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : [];
  const discovered = data.flatMap((entry) => {
    const raw = typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry as { id?: unknown; name?: unknown }).id ?? (entry as { name?: unknown }).name : "";
    return typeof raw === "string" && raw.trim() ? [nameTransform(raw.trim())] : [];
  });
  const ids = [...new Set(discovered.filter(Boolean))].slice(0, 100);
  if (!ids.length) return fallback;
  return ids.map((id) => fallback.find((entry) => entry.id === id) ?? { id, label: id });
};

export const usageFromOpenAI = (usage: unknown): AIUsageMetadata | undefined => {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  const promptTokens = typeof value.prompt_tokens === "number" ? value.prompt_tokens : undefined;
  const completionTokens = typeof value.completion_tokens === "number" ? value.completion_tokens : undefined;
  const totalTokens = typeof value.total_tokens === "number" ? value.total_tokens : undefined;
  return promptTokens === undefined && completionTokens === undefined && totalTokens === undefined ? undefined : { promptTokens, completionTokens, totalTokens };
};

export const usageFromGemini = (usage: unknown): AIUsageMetadata | undefined => {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown };
  const promptTokens = typeof value.promptTokenCount === "number" ? value.promptTokenCount : undefined;
  const completionTokens = typeof value.candidatesTokenCount === "number" ? value.candidatesTokenCount : undefined;
  const totalTokens = typeof value.totalTokenCount === "number" ? value.totalTokenCount : undefined;
  return promptTokens === undefined && completionTokens === undefined && totalTokens === undefined ? undefined : { promptTokens, completionTokens, totalTokens };
};

export const streamResponseLines = async function* (response: Response, provider: string, signal?: AbortSignal): AsyncIterable<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new AIProviderRequestError(`${provider} did not provide a streaming response.`, "STREAM_ERROR");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parsed = linesFromChunk(buffer);
      buffer = parsed.remainder;
      yield* parsed.complete;
    }
    buffer += decoder.decode();
    if (buffer) yield buffer;
  } catch (error) {
    if (error instanceof AIProviderRequestError) throw error;
    if (signal?.aborted || error instanceof Error && error.name === "AbortError") throw new AICancelledError();
    throw new AIProviderRequestError(`${provider} streaming failed. Please try again.`, "STREAM_ERROR");
  } finally {
    reader.releaseLock();
  }
};
