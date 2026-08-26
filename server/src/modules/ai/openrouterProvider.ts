import { OpenAICompatibleProvider } from "./openAICompatibleProvider";

const catalog = [
  { id: "openrouter/auto", label: "Auto router" },
  { id: "qwen/qwen3-coder", label: "Qwen Coder" }
];

export interface OpenRouterProviderOptions {
  apiKey: string;
  defaultModel?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

export const createOpenRouterProvider = (options: OpenRouterProviderOptions) => new OpenAICompatibleProvider({
  ...options,
  id: "openrouter",
  label: "OpenRouter",
  completionUrl: "https://openrouter.ai/api/v1/chat/completions",
  modelsUrl: "https://openrouter.ai/api/v1/models",
  catalog
});
