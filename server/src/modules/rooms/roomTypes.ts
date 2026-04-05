import type { SupportedLanguage } from "../../constants/languages";

export type RoomRole = "owner" | "editor" | "viewer";
export type ParticipantAccent = "blue" | "emerald" | "amber" | "rose" | "violet" | "cyan";

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
  socketId?: string;
  cursor: CursorState;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

export interface RoomState {
  roomId: string;
  ownerId: string;
  language: SupportedLanguage;
  code: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  participants: Record<string, Participant>;
  chat: ChatMessage[];
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

