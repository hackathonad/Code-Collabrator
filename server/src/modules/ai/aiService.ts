
import type {
  AICompletionResult,
  AIProviderAdapter,
  AIProviderDescriptor,
  AIProviderId,
  AIService,
  AIStreamEvent
} from "./aiTypes";
import { AIProviderUnavailableError } from "./aiTypes";

type ProviderRuntimeDescriptor = Omit<AIProviderDescriptor, "configured">;

const unavailableProvider = (
  id: AIProviderId,
  label: string,
  models: AIProviderDescriptor["models"] = [],
  supportsLocalModels = false
): ProviderRuntimeDescriptor => ({
  id,
  label,
  available: false,
  health: "not-configured",
  supportsStreaming: true,
  supportsLocalModels,
  models,
  defaultModel: null
});

const providerCatalog: ProviderRuntimeDescriptor[] = [
  unavailableProvider("gemini", "Gemini", [{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }]),
  unavailableProvider("groq", "Groq", [{ id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { id: "qwen-qwq-32b", label: "Qwen QwQ 32B" }, { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill" }]),
  unavailableProvider("openrouter", "OpenRouter", [{ id: "openrouter/auto", label: "Auto router" }, { id: "qwen/qwen3-coder", label: "Qwen Coder" }]),
  // Ollama models are discovered from the local server; never advertise guesses.
  unavailableProvider("ollama", "Ollama", [], true),
  unavailableProvider("openai", "OpenAI", [{ id: "gpt-4.1-mini", label: "GPT-4.1 mini" }, { id: "gpt-4.1", label: "GPT-4.1" }]),
  unavailableProvider("anthropic", "Anthropic", [{ id: "claude-sonnet", label: "Claude Sonnet" }, { id: "claude-haiku", label: "Claude Haiku" }]),
  { ...unavailableProvider("custom", "Custom provider"), supportsStreaming: false }
];

export const createAIService = (initialAdapters: AIProviderAdapter[] = []): AIService => {
  const adapters = new Map<AIProviderId, AIProviderAdapter>();
  const runtimeDescriptors = new Map<AIProviderId, ProviderRuntimeDescriptor>();

  const getAdapter = (provider: AIProviderId) => {
    const adapter = adapters.get(provider);
    if (!adapter) throw new AIProviderUnavailableError(provider);
    return adapter;
  };

  const getProviders = () => providerCatalog.map((provider) => {
    const adapter = adapters.get(provider.id);
    if (!adapter) return { ...provider, configured: false };
    return { ...(runtimeDescriptors.get(provider.id) ?? adapter.descriptor), id: adapter.id, configured: adapter.isConfigured?.() ?? true };
  });

  const registerProvider = (adapter: AIProviderAdapter) => {
    adapters.set(adapter.id, adapter);
    runtimeDescriptors.set(adapter.id, adapter.descriptor);
  };

  initialAdapters.forEach(registerProvider);

  return {
    getProviders,
    async refreshProviders() {
      await Promise.all([...adapters.values()].map(async (adapter) => {
        if (!adapter.refreshDescriptor) return;
        runtimeDescriptors.set(adapter.id, await adapter.refreshDescriptor());
      }));
      return getProviders();
    },
    registerProvider,
    async complete(provider, request): Promise<AICompletionResult> {
      return getAdapter(provider).complete(request);
    },
    stream(provider, request): AsyncIterable<AIStreamEvent> {
      const adapter = getAdapter(provider);
      if (!adapter.stream) throw new AIProviderUnavailableError(provider, "This provider does not support streaming yet");
      return adapter.stream(request);
    }
  };
};

export const aiService = createAIService();
