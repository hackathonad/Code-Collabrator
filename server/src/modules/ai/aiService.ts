
import type {
  AICompletionRequest,
  AICompletionResult,
  AIProviderAdapter,
  AIProviderDescriptor,
  AIProviderId,
  AIService,
  AIStreamEvent
} from "./aiTypes";
import { AIProviderRequestError, AIProviderUnavailableError } from "./aiTypes";

type ProviderRuntimeDescriptor = Omit<AIProviderDescriptor, "configured">;

const unavailableProvider = (
  id: AIProviderId,
  label: string,
  models: AIProviderDescriptor["models"] = [],
  supportsLocalModels = false,
  capabilities: AIProviderDescriptor["capabilities"] = ["chat", "streaming"]
): ProviderRuntimeDescriptor => ({
  id,
  name: id,
  label,
  available: false,
  health: "not-configured",
  capabilities,
  supportsStreaming: capabilities.includes("streaming"),
  supportsToolCalling: capabilities.includes("tools"),
  supportsVision: capabilities.includes("vision"),
  supportsLocalModels,
  models,
  defaultModel: null
});

const providerCatalog: ProviderRuntimeDescriptor[] = [
  unavailableProvider("ollama", "Ollama", [], true, ["chat", "streaming", "local-models"]),
  unavailableProvider("gemini", "Gemini", [{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }]),
  unavailableProvider("groq", "Groq", [{ id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { id: "qwen-qwq-32b", label: "Qwen QwQ 32B" }, { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill" }]),
  unavailableProvider("openrouter", "OpenRouter", [{ id: "openrouter/auto", label: "Auto router" }, { id: "qwen/qwen3-coder", label: "Qwen Coder" }]),
  unavailableProvider("openai", "OpenAI", [{ id: "gpt-4.1-mini", label: "GPT-4.1 mini" }, { id: "gpt-4.1", label: "GPT-4.1" }]),
  unavailableProvider("anthropic", "Anthropic", [{ id: "claude-sonnet-4-20250514", label: "Claude Sonnet" }, { id: "claude-3-5-haiku-20241022", label: "Claude Haiku" }]),
  { ...unavailableProvider("custom", "Custom provider"), supportsStreaming: false, capabilities: ["chat"] }
];

const descriptorFor = (provider: AIProviderId) => providerCatalog.find((entry) => entry.id === provider);

export const createAIService = (initialAdapters: AIProviderAdapter[] = []): AIService => {
  const adapters = new Map<AIProviderId, AIProviderAdapter>();
  const runtimeDescriptors = new Map<AIProviderId, ProviderRuntimeDescriptor>();

  const getAdapter = (provider: AIProviderId) => {
    const adapter = adapters.get(provider);
    if (!adapter) throw new AIProviderUnavailableError(provider, "This AI provider is not available on the server.", "PROVIDER_UNAVAILABLE");
    return adapter;
  };

  const getProviders = () => providerCatalog.map((provider) => {
    const adapter = adapters.get(provider.id);
    if (!adapter) return { ...provider, configured: false, available: false, health: "not-configured" as const, defaultModel: null };
    const configured = adapter.isConfigured?.() ?? true;
    const runtime = runtimeDescriptors.get(provider.id) ?? adapter.descriptor;
    return {
      ...provider,
      ...runtime,
      id: adapter.id,
      name: runtime.name ?? adapter.id,
      configured,
      available: configured && runtime.available,
      health: configured ? runtime.health : "not-configured",
      defaultModel: configured ? runtime.defaultModel : null
    };
  });

  const registerProvider = (adapter: AIProviderAdapter) => {
    adapters.set(adapter.id, adapter);
    runtimeDescriptors.set(adapter.id, adapter.descriptor);
  };

  const validateRequest = (provider: AIProviderId, request: AICompletionRequest) => {
    const catalogEntry = descriptorFor(provider);
    if (!catalogEntry) throw new AIProviderUnavailableError(provider, "This AI provider is not supported.", "PROVIDER_UNAVAILABLE");
    const descriptor = getProviders().find((entry) => entry.id === provider);
    if (!descriptor?.configured) throw new AIProviderUnavailableError(provider, `${catalogEntry.label} is not configured on the server.`, "PROVIDER_NOT_CONFIGURED");
    if (!descriptor.available) {
      const message = descriptor.health === "no-models"
        ? `${catalogEntry.label} is running, but no models are available.`
        : `${catalogEntry.label} is unavailable. Try refreshing providers and try again.`;
      throw new AIProviderUnavailableError(provider, message, "PROVIDER_UNAVAILABLE");
    }
    const model = request.settings.model.trim();
    if (!model || !descriptor.models.some((entry) => entry.id === model)) {
      throw new AIProviderRequestError(`The selected ${catalogEntry.label} model is not available.`, "MODEL_NOT_FOUND");
    }
  };

  initialAdapters.forEach(registerProvider);

  return {
    getProviders,
    async refreshProviders() {
      await Promise.all([...adapters.values()].map(async (adapter) => {
        const configured = adapter.isConfigured?.() ?? true;
        if (!configured) {
          runtimeDescriptors.set(adapter.id, { ...adapter.descriptor, available: false, health: "not-configured", defaultModel: null });
          return;
        }
        if (!adapter.refreshDescriptor) return;
        try {
          runtimeDescriptors.set(adapter.id, await adapter.refreshDescriptor());
        } catch {
          runtimeDescriptors.set(adapter.id, { ...adapter.descriptor, available: false, health: "unavailable" });
        }
      }));
      return getProviders();
    },
    registerProvider,
    async complete(provider, request): Promise<AICompletionResult> {
      validateRequest(provider, request);
      return getAdapter(provider).complete(request);
    },
    stream(provider, request): AsyncIterable<AIStreamEvent> {
      validateRequest(provider, request);
      const adapter = getAdapter(provider);
      if (!adapter.stream) throw new AIProviderUnavailableError(provider, "This provider does not support streaming yet", "PROVIDER_UNAVAILABLE");
      return adapter.stream(request);
    }
  };
};

export const aiService = createAIService();
