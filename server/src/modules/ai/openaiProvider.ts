import { OpenAICompatibleProvider } from "./openAICompatibleProvider";

const catalog = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" }
];

export interface OpenAIProviderOptions {
  apiKey: string;
  defaultModel?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

export const createOpenAIProvider = (options: OpenAIProviderOptions) => new OpenAICompatibleProvider({
  ...options,
  id: "openai",
  label: "OpenAI",
  completionUrl: "https://api.openai.com/v1/chat/completions",
  modelsUrl: "https://api.openai.com/v1/models",
  catalog
});
