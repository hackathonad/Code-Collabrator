export type SupportedLanguage = "javascript" | "python" | "cpp";
export type RoomRole = "owner" | "editor" | "viewer";
export type ParticipantAccent = "blue" | "emerald" | "amber" | "rose" | "violet" | "cyan";
export type AiAction = "predict" | "explain";

export interface CursorState {
  lineNumber: number;
  column: number;
}

export interface Participant {
  userId: string;
  username: string;
  role: RoomRole;
  accent: ParticipantAccent;
  joinedAt: number;
  isOnline: boolean;
  cursor: CursorState;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

export interface RoomSnapshot {
  roomId: string;
  ownerId: string;
  language: SupportedLanguage;
  code: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  participants: Participant[];
  chat: ChatMessage[];
}

export interface UserSession {
  roomId: string;
  userId: string;
  username: string;
}

export interface ExecutionResult {
  output: string;
  error: string | null;
  language: SupportedLanguage;
}

export interface AiResult {
  mode: "fallback" | "ai";
  result: string;
}

