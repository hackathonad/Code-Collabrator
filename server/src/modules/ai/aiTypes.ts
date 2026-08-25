
import type { SupportedLanguage } from "../../constants/languages";

export type AIProviderId = "gemini" | "groq" | "openrouter" | "ollama" | "openai" | "anthropic" | "custom";
export type AIAction = "explain" | "generate" | "fix" | "optimize" | "refactor" | "test" | "document" | "summarize" | "review" | "error" | "custom";
export type AIMessageRole = "system" | "user" | "assistant";
export type AIProviderHealth = "healthy" | "unavailable" | "no-models" | "not-configured";
export type AIErrorCode = "BACKEND_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "PROVIDER_NOT_CONFIGURED" | "MODEL_UNAVAILABLE" | "AUTHENTICATION_FAILED" | "RATE_LIMITED" | "REQUEST_TIMEOUT" | "INVALID_REQUEST" | "ROOM_SESSION_INVALID" | "STREAM_FAILED" | "CANCELLED" | "UNKNOWN_PROVIDER_ERROR";

export interface AIModelDescriptor { id: string; label: string; contextWindow?: number; }
export interface AIProviderDescriptor { id: AIProviderId; label: string; configured: boolean; available: boolean; health: AIProviderHealth; supportsStreaming: boolean; supportsLocalModels: boolean; models: AIModelDescriptor[]; defaultModel: string | null; }
export interface AISettings { provider: AIProviderId; model: string; temperature: number; maxTokens: number; streaming: boolean; systemPrompt?: string; workspaceContextSize: "minimal" | "standard" | "extended"; }
export interface AIChatMessage { role: AIMessageRole; content: string; }
export interface AIExecutionContext { output: string; failed: boolean; }
export interface AIRequestInput { action: AIAction; prompt: string; currentFileId?: string; selectedCode?: string; selectedCodeFileId?: string; conversation: AIChatMessage[]; settings: AISettings; execution?: AIExecutionContext; }
export interface AIContextPayload {
  workspaceId: string; workspaceName: string; language: SupportedLanguage;
  currentFile: { id: string; name: string; language: SupportedLanguage; content: string } | null;
  selectedCode?: string;
  openFiles: Array<{ id: string; name: string; language: SupportedLanguage; content: string }>;
  workspaceSummary: string; projectMetadata: string; recentChat: AIChatMessage[]; recentHistory: string[];
  execution?: AIExecutionContext; characterCount: number; estimatedTokens: number; includedSections: string[]; excludedSections: string[]; truncated: boolean;
}
export interface AICompletionRequest { messages: AIChatMessage[]; settings: AISettings; metadata: { workspaceId: string; action: AIAction; language: SupportedLanguage }; signal?: AbortSignal; }
export interface AICompletionResult { content: string; model: string; provider: AIProviderId; finishReason?: string; }
export interface AIStreamEvent { type: "delta" | "complete" | "error"; content?: string; result?: AICompletionResult; message?: string; }
export interface AIProviderAdapter { id: AIProviderId; descriptor: Omit<AIProviderDescriptor, "configured">; isConfigured?(): boolean; refreshDescriptor?(): Promise<Omit<AIProviderDescriptor, "configured">>; complete(request: AICompletionRequest): Promise<AICompletionResult>; stream?(request: AICompletionRequest): AsyncIterable<AIStreamEvent>; }
export interface AIService { getProviders(): AIProviderDescriptor[]; refreshProviders(): Promise<AIProviderDescriptor[]>; registerProvider(adapter: AIProviderAdapter): void; complete(provider: AIProviderId, request: AICompletionRequest): Promise<AICompletionResult>; stream(provider: AIProviderId, request: AICompletionRequest): AsyncIterable<AIStreamEvent>; }
export class AIProviderUnavailableError extends Error { constructor(public readonly provider: AIProviderId, message = "This AI provider is not configured yet", public readonly code: AIErrorCode = "PROVIDER_UNAVAILABLE") { super(message); this.name = "AIProviderUnavailableError"; } }
export class AIProviderRequestError extends Error { constructor(message = "The AI provider could not complete this request", public readonly code: AIErrorCode = "UNKNOWN_PROVIDER_ERROR") { super(message); this.name = "AIProviderRequestError"; } }
export class AICancelledError extends Error { constructor(message = "AI generation was cancelled.") { super(message); this.name = "AICancelledError"; } }
