import { create } from "zustand";
import { api } from "../lib/api";
import type { AIAction, AIConversation, AIConversationMessage, AILifecycleState, AIProviderDescriptor, AIRequestContext, AISelection, AISettings } from "../types/ai";
import type { AgentEvent, AgentMode, AgentPatch, AgentProposalEvent, AgentProposalPublic, AgentProposalStatus, AgentTaskEvent, AgentTaskPublic, AgentValidationSummary } from "../types/agent";

const STORAGE_KEY = "code-sphere-ai-state";
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 60;
const messageId = () => crypto.randomUUID();
const defaultSettings: AISettings = { provider: "ollama", model: "", temperature: 0.2, maxTokens: 2_000, streaming: true, workspaceContextSize: "standard" };
const promptLabels: Record<AIAction, string> = { explain: "Explain", generate: "Generate", fix: "Fix", optimize: "Optimize", refactor: "Refactor", test: "Generate tests for", document: "Document", summarize: "Summarize", review: "Review", error: "Explain error in", custom: "Ask about" };
let activeController: AbortController | null = null;
let activeRequestId: string | null = null;
let activeCancelContext: { roomId: string; guestToken?: string } | null = null;

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
const continuityFor = (events: AgentEvent[]) => {
  const items = events.slice(-8).flatMap((event) => {
    if (event.type === "status") return [`status: ${event.message}`];
    if (event.type === "context") return [`context: ${event.files.length} relevant file(s)`];
    if (event.type === "plan") return [`plan: ${event.steps.slice(0, 3).join("; ")}`];
    if (event.type === "diagnosis") return [`diagnosis: ${event.hypotheses.slice(0, 3).map((hypothesis) => `${hypothesis.confidence} ${hypothesis.title}`).join("; ")}`];
    if (event.type === "tool_result") return [`tool result: ${event.tool} — ${event.summary}`];
    if (event.type === "patch_review") return [`patch review: ${event.findings.length} finding(s)`];
    if (event.type === "review") return [`review: ${event.findings.length} finding(s)`];
    if (event.type === "validation" || event.type === "execution") return [`validation: ${event.category} — ${event.summary}`];
    return [];
  });
  return items.join("\n").replace(/(api[_-]?key|secret|password|token)\s*([:=])\s*([^\s,;]+)/gi, "$1$2 [REDACTED]").slice(0, 3_600);
};
interface AIStoreState {
  roomId: string | null; workspaceId: string | null; conversations: AIConversation[]; activeConversationId: string | null; providers: AIProviderDescriptor[]; settings: AISettings; action: AIAction; agentMode: AgentMode; draft: string; continuationTaskId: string | null; selection: AISelection | null; agentActivity: AgentEvent[]; agentPatches: AgentPatch[]; agentProposalEvents: AgentProposalEvent[]; agentTasks: AgentTaskPublic[]; agentValidations: Record<string, AgentValidationSummary>; loadingProviders: boolean; lifecycle: AILifecycleState; generating: boolean; error: string | null;
  initialize: (roomId: string, workspaceId: string) => Promise<void>; refreshProviders: () => Promise<void>;
  setAction: (action: AIAction) => void; setAgentMode: (mode: AgentMode) => void; setDraft: (draft: string) => void; setSelection: (selection: AISelection | null) => void; setSettings: (settings: Partial<AISettings>) => void; clearAgentActivity: () => void; receiveAgentProposalEvent: (event: AgentProposalEvent) => void; setAgentProposalHistory: (events: AgentProposalEvent[]) => void; setAgentProposalState: (proposals: AgentProposalPublic[]) => void; receiveAgentTask: (event: AgentTaskEvent) => void; setAgentTaskHistory: (tasks: AgentTaskPublic[]) => void; recordAgentValidation: (taskId: string | undefined, validation: AgentValidationSummary) => void; markAgentPatchesStale: (version: number) => void; markAgentPatchStatus: (patchId: string, status: AgentProposalStatus) => void;
  newConversation: () => void; selectConversation: (id: string) => void; deleteConversation: (id: string) => void; clearConversation: () => void; send: (context: AIRequestContext) => Promise<void>; retryLast: (context: AIRequestContext) => Promise<void>; continueTask: (context: AIRequestContext) => Promise<void>; cancelGeneration: () => void; clearRuntime: () => void;
}

const persisted = typeof window === "undefined" ? { conversations: [], settings: defaultSettings } : readPersisted();
export const useAIStore = create<AIStoreState>((set, get) => ({
  roomId: null, workspaceId: null, conversations: persisted.conversations, activeConversationId: null, providers: [], settings: persisted.settings, action: "explain", agentMode: "ASK", draft: "", continuationTaskId: null, selection: null, agentActivity: [], agentPatches: [], agentProposalEvents: [], agentTasks: [], agentValidations: {}, loadingProviders: false, lifecycle: "idle", generating: false, error: null,
  refreshProviders: async () => {
    set({ loadingProviders: true });
    try {
      const providers = await api.getAIProviders(); const current = get().settings;
      const selected = providers.find((provider) => provider.id === current.provider);
      const selectedModel = selected?.models.some((model) => model.id === current.model)
        ? current.model
        : selected?.defaultModel ?? selected?.models[0]?.id ?? current.model;
      const settings = selected
        ? { ...current, model: selectedModel }
        : current;
      set({ providers, settings, loadingProviders: false }); savePersisted(get().conversations, settings);
    } catch { set({ loadingProviders: false, error: "Cannot reach the Code Collaborator server. AI providers could not be loaded." }); }
  },
  initialize: async (roomId, workspaceId) => {
    get().cancelGeneration(); const current = get();
    const matching = current.conversations.filter((conversation) => conversation.roomId === roomId && conversation.workspaceId === workspaceId).sort((left, right) => right.updatedAt - left.updatedAt);
    const active = matching[0] ?? createConversation(roomId, workspaceId); const conversations = matching.length ? current.conversations : [...current.conversations, active];
    set({ roomId, workspaceId, conversations, activeConversationId: active.id, continuationTaskId: null, selection: null, agentActivity: [], agentPatches: [], agentProposalEvents: [], agentTasks: [], agentValidations: {}, error: null, lifecycle: "idle" }); savePersisted(conversations, current.settings);
    await get().refreshProviders();
  },
  setAction: (action) => set({ action }), setAgentMode: (agentMode) => set({ agentMode }), setDraft: (draft) => set({ draft }), setSelection: (selection) => set({ selection }),
  setSettings: (settings) => set((state) => { const next = { ...state.settings, ...settings }; savePersisted(state.conversations, next); return { settings: next }; }),
  clearAgentActivity: () => set({ agentActivity: [], agentPatches: [], agentProposalEvents: [] }),
  receiveAgentProposalEvent: (event) => set((state) => {
    if (event.roomId !== state.roomId) return state;
    const status: AgentProposalStatus = event.type === "proposal_applied" ? "applied" : event.type === "proposal_rejected" ? "rejected" : event.type === "proposal_stale" ? "stale" : event.type === "proposal_approved" ? "approved" : "pending";
    const agentPatches = state.agentPatches.map((patch) => patch.patchId === event.patchId ? { ...patch, status, applied: status === "applied" } : patch);
    const agentProposalEvents = [...state.agentProposalEvents.filter((entry) => !(entry.patchId === event.patchId && entry.type === event.type)), event].slice(-40);
    return { agentPatches, agentProposalEvents };
  }),
  setAgentProposalHistory: (events) => set((state) => {
    const merged = new Map(state.agentProposalEvents.map((event) => [`${event.patchId}:${event.type}`, event]));
    events.filter((event) => event.roomId === state.roomId).forEach((event) => merged.set(`${event.patchId}:${event.type}`, event));
    return { agentProposalEvents: [...merged.values()].slice(-40) };
  }),
  setAgentProposalState: (proposals) => set((state) => {
    if (!state.roomId) return state;
    const restored = proposals.filter((proposal) => proposal.roomId === state.roomId).map((proposal): AgentPatch => ({
      patchId: proposal.patchId,
      ...(proposal.taskId ? { taskId: proposal.taskId } : {}),
      roomId: proposal.roomId,
      workspaceId: proposal.workspaceId,
      fileId: proposal.fileId,
      path: proposal.path,
      baseVersion: proposal.baseVersion,
      expectedContent: "",
      replacement: "",
      additions: proposal.additions,
      deletions: proposal.deletions,
      preview: proposal.preview,
      applied: proposal.applied,
      status: proposal.status,
      files: proposal.files.map((file) => ({ ...file, expectedContent: "", replacement: "", preview: "" })),
      review: proposal.review
    }));
    const merged = new Map(state.agentPatches.map((patch) => [patch.patchId, patch]));
    restored.forEach((patch) => { const existing = merged.get(patch.patchId); merged.set(patch.patchId, existing && existing.expectedContent ? { ...existing, status: patch.status, applied: patch.applied } : patch); });
    return { agentPatches: [...merged.values()].slice(-20) };
  }),
  receiveAgentTask: (event) => set((state) => {
    if (event.task.roomId !== state.roomId) return state;
    const existing = state.agentTasks.find((task) => task.taskId === event.task.taskId);
    if (existing && existing.updatedAt > event.task.updatedAt) return state;
    return { agentTasks: [event.task, ...state.agentTasks.filter((task) => task.taskId !== event.task.taskId)].slice(0, 40) };
  }),
  setAgentTaskHistory: (tasks) => set((state) => {
    const merged = new Map(state.agentTasks.filter((task) => task.roomId === state.roomId).map((task) => [task.taskId, task]));
    tasks.filter((task) => task.roomId === state.roomId).forEach((task) => { const existing = merged.get(task.taskId); if (!existing || task.updatedAt >= existing.updatedAt) merged.set(task.taskId, task); });
    return { agentTasks: [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 40) };
  }),
  recordAgentValidation: (taskId, validation) => set((state) => ({ agentValidations: taskId ? { ...state.agentValidations, [taskId]: validation } : state.agentValidations })),
  markAgentPatchesStale: (version) => set((state) => ({ agentPatches: state.agentPatches.map((patch) => patch.status === "pending" && patch.baseVersion < version ? { ...patch, status: "stale" } : patch) })),
  markAgentPatchStatus: (patchId, status) => set((state) => ({ agentPatches: state.agentPatches.map((patch) => patch.patchId === patchId ? { ...patch, status, applied: status === "applied" } : patch) })),
  newConversation: () => set((state) => { get().cancelGeneration(); if (!state.roomId || !state.workspaceId) return {}; const conversation = createConversation(state.roomId, state.workspaceId); const conversations = [...state.conversations, conversation]; savePersisted(conversations, state.settings); return { conversations, activeConversationId: conversation.id, draft: "", error: null, lifecycle: "idle" }; }),
  selectConversation: (id) => set((state) => state.conversations.some((conversation) => conversation.id === id && conversation.roomId === state.roomId && conversation.workspaceId === state.workspaceId) ? { activeConversationId: id, error: null } : {}),
  deleteConversation: (id) => set((state) => { if (id === state.activeConversationId) get().cancelGeneration(); const conversations = state.conversations.filter((conversation) => conversation.id !== id); const fallback = conversations.filter((conversation) => conversation.roomId === state.roomId && conversation.workspaceId === state.workspaceId).sort((left, right) => right.updatedAt - left.updatedAt)[0]; savePersisted(conversations, state.settings); return { conversations, activeConversationId: fallback?.id ?? null }; }),
  clearConversation: () => set((state) => { get().cancelGeneration(); if (!state.activeConversationId) return {}; const conversations = updateConversation(state.conversations, state.activeConversationId, (conversation) => ({ ...conversation, title: "New AI conversation", updatedAt: Date.now(), messages: [] })); savePersisted(conversations, state.settings); return { conversations, draft: "", error: null, lifecycle: "idle" }; }),
  cancelGeneration: () => {
    const requestId = activeRequestId; const cancelContext = activeCancelContext; activeController?.abort(); activeController = null; activeRequestId = null; activeCancelContext = null;
    if (!requestId) return;
    const stateBeforeCancel = get();
    if (cancelContext && stateBeforeCancel.conversations.some((conversation) => conversation.messages.some((message) => message.id === requestId))) void api.cancelAgentTask(cancelContext.roomId, cancelContext.guestToken, requestId).catch(() => { /* Abort remains authoritative if the cancel request races disconnect. */ });
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
    const controller = new AbortController(); activeController = controller; activeRequestId = assistant.id; activeCancelContext = { roomId: context.roomId, guestToken: context.guestToken };
    set({ conversations, generating: true, lifecycle: "preparing-context", error: null, draft: "", agentActivity: [], agentPatches: [], agentProposalEvents: [] }); savePersisted(conversations, state.settings);
    const isCurrent = () => activeRequestId === assistant.id && get().roomId === context.roomId && get().workspaceId === context.workspaceId && get().activeConversationId === conversation.id;
    const setAssistantContent = (content: string) => { if (!isCurrent()) return; set((latest) => ({ conversations: updateConversation(latest.conversations, conversation.id, (entry) => ({ ...entry, updatedAt: Date.now(), messages: entry.messages.map((message) => message.id === assistant.id ? { ...message, content } : message) })) })); };
    const handleAgentEvent = (event: AgentEvent) => {
      if (!isCurrent()) return;
      set((latest) => {
        const nextActivity = [...latest.agentActivity, event].slice(-40);
        const nextPatches = event.type === "patch_proposal" && !latest.agentPatches.some((patch) => patch.patchId === event.patch.patchId) ? [...latest.agentPatches, event.patch].slice(-20) : latest.agentPatches;
        const message = event.type === "status" ? event.message.toLowerCase() : "";
        const lifecycle = event.type === "patch_proposal" ? "waiting-for-approval" : event.type === "validation" || event.type === "execution" ? "validating" : event.type === "status" && message.includes("prepar") ? "preparing-context" : event.type === "status" ? "streaming" : latest.lifecycle;
        return { agentActivity: nextActivity, agentPatches: nextPatches, lifecycle };
      });
      if (event.type === "final") setAssistantContent(event.text);
    };
    try {
      const history = conversation.messages.filter((message): message is AIConversationMessage & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant").slice(-8).map((message) => ({ role: message.role, content: message.content }));
      const request = { roomId: context.roomId, guestToken: context.guestToken, workspaceId: context.workspaceId, mode: state.agentMode, intent: state.action, prompt: userMessage.content, taskId: assistant.id, ...(state.continuationTaskId ? { continuationTaskId: state.continuationTaskId } : {}), conversationId: conversation.id, continuitySummary: continuityFor(state.agentActivity), currentFileId: context.currentFileId, selectedCode: state.selection?.code, selectedCodeFileId: state.selection?.fileId, selectionStartOffset: state.selection?.startOffset, selectionEndOffset: state.selection?.endOffset, conversation: history, settings: state.settings, execution: context.execution, diagnostics: context.diagnostics };
      set({ lifecycle: "connecting" });
      if (state.settings.streaming && provider.supportsStreaming) {
        set({ lifecycle: "streaming" });
        await api.streamAgent(request, handleAgentEvent, controller.signal);
      } else {
        const result = await api.completeAgent(request, controller.signal); if (isCurrent()) { result.events.forEach(handleAgentEvent); setAssistantContent(result.finalText); }
      }
      if (isCurrent()) { activeController = null; activeRequestId = null; activeCancelContext = null; const latest = get(); set({ generating: false, continuationTaskId: null, lifecycle: latest.agentPatches.length ? "waiting-for-approval" : "completed" }); savePersisted(latest.conversations, latest.settings); }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!isCurrent()) return;
      activeController = null; activeRequestId = null; activeCancelContext = null; const message = error instanceof Error ? error.message : "AI request failed.";
      const latest = get(); const failed = updateConversation(latest.conversations, conversation.id, (entry) => ({ ...entry, updatedAt: Date.now(), messages: [...entry.messages, { id: messageId(), role: "error", content: message, createdAt: Date.now(), action: state.action }] }));
      set({ conversations: failed, generating: false, continuationTaskId: null, lifecycle: "failed", error: message }); savePersisted(failed, latest.settings);
    }
  },
  retryLast: async (context) => { const state = get(); const conversation = state.conversations.find((entry) => entry.id === state.activeConversationId); const lastUser = [...(conversation?.messages ?? [])].reverse().find((message) => message.role === "user"); if (!lastUser) return; set({ draft: lastUser.content, action: lastUser.action ?? "custom" }); await get().send(context); },
  continueTask: async (context) => { const state = get(); const task = state.agentTasks.find((entry) => entry.roomId === context.roomId && ["waiting_for_approval", "conflict", "failed", "timed_out"].includes(entry.status)); if (!task || state.generating) return; set({ draft: "Continue the previous coding task using the current room state.", continuationTaskId: task.taskId, action: task.intent, agentMode: task.mode, error: null }); await get().send(context); },
  clearRuntime: () => { get().cancelGeneration(); set({ roomId: null, workspaceId: null, activeConversationId: null, continuationTaskId: null, selection: null, draft: "", agentActivity: [], agentPatches: [], agentProposalEvents: [], agentTasks: [], agentValidations: {}, generating: false, lifecycle: "idle", error: null }); }
}));
