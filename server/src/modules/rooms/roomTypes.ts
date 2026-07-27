import type { SupportedLanguage } from "../../constants/languages";

export type RoomRole = "owner" | "editor" | "viewer";
export type ParticipantAccent = "blue" | "emerald" | "amber" | "rose" | "violet" | "cyan";
export type PresenceStatus = "active" | "idle" | "offline";

export interface CursorState {
  lineNumber: number;
  column: number;
}

export interface ParticipantSnapshot {
  userId: string;
  username: string;
  role: RoomRole;
  accent: ParticipantAccent;
  joinedAt: number;
  isOnline: boolean;
  status: PresenceStatus;
  lastActiveAt: number;
  cursor: CursorState;
  editsCount: number;
  timeSpentMs: number;
}

export interface Participant extends ParticipantSnapshot {
  socketId?: string;
  activeSessionStartedAt?: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

export type HistoryReason =
  | "initial"
  | "autosave"
  | "language-change"
  | "restart"
  | "restore"
  | "checkpoint";

export interface HistoryEntry {
  id: string;
  roomVersion: number;
  language: SupportedLanguage;
  code: string;
  createdAt: number;
  createdByUserId: string;
  createdByUsername: string;
  reason: HistoryReason;
}

export interface RoomState {
  roomId: string;
  ownerId: string;
  language: SupportedLanguage;
  code: string;
  isPaused: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
  participants: Record<string, Participant>;
  chat: ChatMessage[];
  history: HistoryEntry[];
}

export interface RoomSnapshot {
  roomId: string;
  ownerId: string;
  language: SupportedLanguage;
  code: string;
  isPaused: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
  participants: ParticipantSnapshot[];
  chat: ChatMessage[];
  history: HistoryEntry[];
}
