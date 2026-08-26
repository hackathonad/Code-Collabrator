export type AIProviderId = "gemini" | "groq" | "openrouter" | "ollama" | "openai" | "anthropic" | "custom";
export type AIAction = "explain" | "generate" | "fix" | "optimize" | "refactor" | "test" | "document" | "summarize" | "review" | "error" | "custom";
export type AIMessageRole = "user" | "assistant" | "error";
export type AIProviderHealth = "healthy" | "unavailable" | "no-models" | "not-configured";
export type AIProviderCapability = "chat" | "streaming" | "tools" | "vision" | "local-models";
export type AILifecycleState = "idle" | "preparing-context" | "connecting" | "streaming" | "waiting-for-approval" | "validating" | "completed" | "cancelled" | "timed-out" | "failed";
export interface AIModelDescriptor { id: string; label: string; contextWindow?: number; }
export interface AIProviderDescriptor { id: AIProviderId; name: string; label: string; configured: boolean; available: boolean; health: AIProviderHealth; capabilities: AIProviderCapability[]; supportsStreaming: boolean; supportsToolCalling: boolean; supportsVision: boolean; supportsLocalModels: boolean; models: AIModelDescriptor[]; defaultModel: string | null; }
export interface AISettings { provider: AIProviderId; model: string; temperature: number; maxTokens: number; streaming: boolean; systemPrompt?: string; workspaceContextSize: "minimal" | "standard" | "extended"; }
export interface AIConversationMessage { id: string; role: AIMessageRole; content: string; createdAt: number; action?: AIAction; provider?: AIProviderId; model?: string; interrupted?: boolean; }
export interface AIConversation { id: string; roomId: string; workspaceId: string; title: string; createdAt: number; updatedAt: number; messages: AIConversationMessage[]; }
export interface AISelection { fileId: string; code: string; startOffset: number; endOffset: number; }
export interface AIUsageMetadata { promptTokens?: number; completionTokens?: number; totalTokens?: number; }
export interface AICompletionResult { content: string; provider: AIProviderId; model: string; finishReason?: string; usage?: AIUsageMetadata; }
export interface AIStreamEvent { type: "delta" | "complete" | "error"; content?: string; result?: AICompletionResult; message?: string; code?: string; }
export interface AIRequestContext { roomId: string; workspaceId: string; currentFileId: string; guestToken?: string; selection?: AISelection | null; execution?: { output: string; failed: boolean }; diagnostics?: import("./agent").AgentDiagnostic[]; }
