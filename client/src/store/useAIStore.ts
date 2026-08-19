import { create } from "zustand";
import { api } from "../lib/api";
import type { AIAction, AIConversation, AIConversationMessage, AILifecycleState, AIProviderDescriptor, AIRequestContext, AISelection, AISettings } from "../types/ai";

const STORAGE_KEY = "code-sphere-ai-state";
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 60;
const messageId = () => crypto.randomUUID();
const defaultSettings: AISettings = { provider: "ollama", model: "", temperature: 0.2, maxTokens: 2_000, streaming: true, workspaceContextSize: "standard" };
const promptLabels: Record<AIAction, string> = { explain: "Explain", generate: "Generate", fix: "Fix", optimize: "Optimize", refactor: "Refactor", test: "Generate tests for", document: "Document", summarize: "Summarize", review: "Review", error: "Explain error in", custom: "Ask about" };
let activeController: AbortController | null = null;
let activeRequestId: string | null = null;

interface PersistedAIState { conversations: AIConversation[]; settings: AISettings; }
const boundedConversations = (conversations: AIConversation[]) => conversations.map((conversation) => ({ ...conversation, messages: conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION) })).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_CONVERSATIONS);
const readPersisted = (): PersistedAIState => { try { const raw = window.localStorage.getItem(STORAGE_KEY); const parsed = raw ? JSON.parse(raw) as Partial<PersistedAIState> : {}; return { conversations: Array.isArray(parsed.conversations) ? boundedConversations(parsed.conversations) : [], settings: { ...defaultSettings, ...(parsed.settings ?? {}) } }; } catch { return { conversations: [], settings: defaultSettings }; } };
const savePersisted = (conversations: AIConversation[], settings: AISettings) => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations: boundedConversations(conversations), settings })); } catch { /* Browser storage is best effort. */ } };
const createConversation = (roomId: string, workspaceId: string): AIConversation => { const now = Date.now(); return { id: messageId(), roomId, workspaceId, title: "New AI conversation", createdAt: now, updatedAt: now, messages: [] }; };
const updateConversation = (conversations: AIConversation[], id: string, update: (conversation: AIConversation) => AIConversation) => conversations.map((conversation) => conversation.id === id ? update(conversation) : conversation);
const titleFor = (action: AIAction, prompt: string) => {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return `${promptLabels[action]} code`;
  return text.length > 56 ? `${text.slice(0, 53)}…` : text;
};

interface AIStoreState {
  roomId: string | null; workspaceId: string | null; conversations: AIConversation[]; activeConversationId: string | null; providers: AIProviderDescriptor[]; settings: AISettings; action: AIAction; draft: string; selection: AISelection | null; loadingProviders: boolean; lifecycle: AILifecycleState; generating: boolean; error: string | null;
  initialize: (roomId: string, workspaceId: string) => Promise<void>; refreshProviders: () => Promise<void>;
  setAction: (action: AIAction) => void; setDraft: (draft: string) => void; setSelection: (selection: AISelection | null) => void; setSettings: (settings: Partial<AISettings>) => void;
  newConversation: () => void; selectConversation: (id: string) => void; deleteConversation: (id: string) => void; clearConversation: () => void; send: (context: AIRequestContext) => Promise<void>; retryLast: (context: AIRequestContext) => Promise<void>; cancelGeneration: () => void; clearRuntime: () => void;
}

const persisted = typeof window === "undefined" ? { conversations: [], settings: defaultSettings } : readPersisted();
export const useAIStore = create<AIStoreState>((set, get) => ({
  roomId: null, workspaceId: null, conversations: persisted.conversations, activeConversationId: null, providers: [], settings: persisted.settings, action: "explain", draft: "", selection: null, loadingProviders: false, lifecycle: "idle", generating: false, error: null,
  refreshProviders: async () => {
    set({ loadingProviders: true });
    try {
      const providers = await api.getAIProviders(); const current = get().settings;
      const selected = providers.find((provider) => provider.id === current.provider && provider.available);
      const fallback = selected ?? providers.find((provider) => provider.id === "ollama" && provider.available) ?? providers.find((provider) => provider.available) ?? providers.find((provider) => provider.configured) ?? null;
      const settings = fallback && (fallback.id !== current.provider || !fallback.models.some((model) => model.id === current.model))
        ? { ...current, provider: fallback.id, model: fallback.defaultModel ?? fallback.models[0]?.id ?? "" }
        : current;
      set({ providers, settings, loadingProviders: false }); savePersisted(get().conversations, settings);
    } catch { set({ loadingProviders: false, error: "Cannot reach the Code Collaborator server. AI providers could not be loaded." }); }
  },
  initialize: async (roomId, workspaceId) => {
    get().cancelGeneration(); const current = get();
    const matching = current.conversations.filter((conversation) => conversation.roomId === roomId && conversation.workspaceId === workspaceId).sort((left, right) => right.updatedAt - left.updatedAt);
    const active = matching[0] ?? createConversation(roomId, workspaceId); const conversations = matching.length ? current.conversations : [...current.conversations, active];
    set({ roomId, workspaceId, conversations, activeConversationId: active.id, selection: null, error: null, lifecycle: "idle" }); savePersisted(conversations, current.settings);
    await get().refreshProviders();
  },
  setAction: (action) => set({ action }), setDraft: (draft) => set({ draft }), setSelection: (selection) => set({ selection }),
  setSettings: (settings) => set((state) => { const next = { ...state.settings, ...settings }; savePersisted(state.conversations, next); return { settings: next }; }),
  newConversation: () => set((state) => { get().cancelGeneration(); if (!state.roomId || !state.workspaceId) return {}; const conversation = createConversation(state.roomId, state.workspaceId); const conversations = [...state.conversations, conversation]; savePersisted(conversations, state.settings); return { conversations, activeConversationId: conversation.id, draft: "", error: null, lifecycle: "idle" }; }),
  selectConversation: (id) => set((state) => state.conversations.some((conversation) => conversation.id === id && conversation.roomId === state.roomId && conversation.workspaceId === state.workspaceId) ? { activeConversationId: id, error: null } : {}),
  deleteConversation: (id) => set((state) => { if (id === state.activeConversationId) get().cancelGeneration(); const conversations = state.conversations.filter((conversation) => conversation.id !== id); const fallback = conversations.filter((conversation) => conversation.roomId === state.roomId && conversation.workspaceId === state.workspaceId).sort((left, right) => right.updatedAt - left.updatedAt)[0]; savePersisted(conversations, state.settings); return { conversations, activeConversationId: fallback?.id ?? null }; }),
  clearConversation: () => set((state) => { get().cancelGeneration(); if (!state.activeConversationId) return {}; const conversations = updateConversation(state.conversations, state.activeConversationId, (conversation) => ({ ...conversation, title: "New AI conversation", updatedAt: Date.now(), messages: [] })); savePersisted(conversations, state.settings); return { conversations, draft: "", error: null, lifecycle: "idle" }; }),
  cancelGeneration: () => {
    const requestId = activeRequestId; activeController?.abort(); activeController = null; activeRequestId = null;
    if (!requestId) return;
    set((state) => {
      const conversations = state.activeConversationId ? updateConversation(state.conversations, state.activeConversationId, (conversation) => ({ ...conversation, updatedAt: Date.now(), messages: conversation.messages.map((message) => message.id === requestId ? { ...message, interrupted: true } : message) })) : state.conversations;
      savePersisted(conversations, state.settings); return { conversations, generating: false, lifecycle: "cancelled", error: null };
    });
  },
  send: async (context) => {
    const state = get(); const conversation = state.conversations.find((entry) => entry.id === state.activeConversationId); const provider = state.providers.find((entry) => entry.id === state.settings.provider); const prompt = state.draft.trim();
    if (!conversation || state.generating || (!prompt && !state.selection?.code) || context.roomId !== state.roomId || context.workspaceId !== state.workspaceId) return;
    if (!provider?.available || !provider.models.some((model) => model.id === state.settings.model)) { set({ error: provider?.health === "no-models" ? "Ollama is running, but no local models are installed." : provider ? `${provider.label} is unavailable.` : "Choose an available AI provider first.", lifecycle: "failed" }); return; }
    const userMessage: AIConversationMessage = { id: messageId(), role: "user", content: prompt || `${promptLabels[state.action]} the selected code.`, createdAt: Date.now(), action: state.action };
    const assistant: AIConversationMessage = { id: messageId(), role: "assistant", content: "", createdAt: Date.now(), provider: state.settings.provider, model: state.settings.model, action: state.action };
    const conversations = updateConversation(state.conversations, conversation.id, (entry) => ({ ...entry, title: entry.messages.length ? entry.title : titleFor(state.action, userMessage.content), updatedAt: Date.now(), messages: [...entry.messages, userMessage, assistant] }));
    const controller = new AbortController(); activeController = controller; activeRequestId = assistant.id;
    set({ conversations, generating: true, lifecycle: "preparing-context", error: null, draft: "" }); savePersisted(conversations, state.settings);
    const isCurrent = () => activeRequestId === assistant.id && get().roomId === context.roomId && get().workspaceId === context.workspaceId && get().activeConversationId === conversation.id;
    const appendDelta = (delta: string) => { if (!isCurrent()) return; set((latest) => ({ conversations: updateConversation(latest.conversations, conversation.id, (entry) => ({ ...entry, updatedAt: Date.now(), messages: entry.messages.map((message) => message.id === assistant.id ? { ...message, content: message.content + delta } : message) })) })); };
    try {
      const history = conversation.messages.filter((message): message is AIConversationMessage & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant").slice(-8).map((message) => ({ role: message.role, content: message.content }));
      const request = { roomId: context.roomId, guestToken: context.guestToken, action: state.action, prompt: userMessage.content, currentFileId: context.currentFileId, selectedCode: state.selection?.code, conversation: history, settings: state.settings, execution: context.execution };
      set({ lifecycle: "connecting" });
      if (state.settings.streaming && provider.supportsStreaming) {
        set({ lifecycle: "streaming" });
        await api.streamAI(request, (event) => { if (event.type === "delta" && event.content) appendDelta(event.content); if (event.type === "complete" && event.result && isCurrent()) set((latest) => ({ conversations: updateConversation(latest.conversations, conversation.id, (entry) => ({ ...entry, messages: entry.messages.map((message) => message.id === assistant.id && !message.content ? { ...message, content: event.result!.content } : message) })) })); }, controller.signal);
      } else {
        const result = await api.completeAI(request, controller.signal); if (isCurrent()) appendDelta(result.content);
      }
      if (isCurrent()) { activeController = null; activeRequestId = null; const latest = get(); set({ generating: false, lifecycle: "completed" }); savePersisted(latest.conversations, latest.settings); }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!isCurrent()) return;
      activeController = null; activeRequestId = null; const message = error instanceof Error ? error.message : "AI request failed.";
      const latest = get(); const failed = updateConversation(latest.conversations, conversation.id, (entry) => ({ ...entry, updatedAt: Date.now(), messages: [...entry.messages, { id: messageId(), role: "error", content: message, createdAt: Date.now(), action: state.action }] }));
      set({ conversations: failed, generating: false, lifecycle: "failed", error: message }); savePersisted(failed, latest.settings);
    }
  },
  retryLast: async (context) => { const state = get(); const conversation = state.conversations.find((entry) => entry.id === state.activeConversationId); const lastUser = [...(conversation?.messages ?? [])].reverse().find((message) => message.role === "user"); if (!lastUser) return; set({ draft: lastUser.content, action: lastUser.action ?? "custom" }); await get().send(context); },
  clearRuntime: () => { get().cancelGeneration(); set({ roomId: null, workspaceId: null, activeConversationId: null, selection: null, draft: "", generating: false, lifecycle: "idle", error: null }); }
}));
