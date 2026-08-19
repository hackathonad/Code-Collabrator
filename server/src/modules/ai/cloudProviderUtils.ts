import { AICancelledError, AIProviderRequestError, type AIErrorCode } from "./aiTypes";

export const configuredModels = (defaultModel: string, catalog: Array<{ id: string; label: string }>) => {
  const models = defaultModel && !catalog.some((model) => model.id === defaultModel)
    ? [{ id: defaultModel, label: defaultModel }, ...catalog]
    : catalog;
  return { models, defaultModel: defaultModel && models.some((model) => model.id === defaultModel) ? defaultModel : models[0]?.id ?? null };
};

export const providerErrorForStatus = (provider: string, status: number) => {
  const details: Record<number, [string, AIErrorCode]> = {
    400: [`${provider} rejected this request. Check the selected model and try again.`, "INVALID_REQUEST"],
    401: [`${provider} authentication failed. Check the server configuration.`, "AUTHENTICATION_FAILED"],
    403: [`${provider} authentication failed. Check the server configuration.`, "AUTHENTICATION_FAILED"],
    404: [`The selected ${provider} model is unavailable.`, "MODEL_UNAVAILABLE"],
    429: [`${provider} rate limit reached. Try again later.`, "RATE_LIMITED"]
  };
  const [message, code] = details[status] ?? [`${provider} could not complete this request.`, "UNKNOWN_PROVIDER_ERROR"];
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
      throw new AIProviderRequestError(`${provider} did not respond before the request timed out.`, "REQUEST_TIMEOUT");
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
