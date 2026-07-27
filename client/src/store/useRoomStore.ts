import { create } from "zustand";
import type { ChatMessage, CursorUpdate, HistoryEntry, Participant, RoomSnapshot, SupportedLanguage, TypingParticipant, UserSession } from "../types/collaboration";

const upsertTypingParticipant = (participants: TypingParticipant[], participant: TypingParticipant, isTyping: boolean) => {
  if (!isTyping) {
    return participants.filter((entry) => entry.userId !== participant.userId);
  }

  return participants.some((entry) => entry.userId === participant.userId)
    ? participants.map((entry) => (entry.userId === participant.userId ? participant : entry))
    : [...participants, participant];
};

interface RoomStoreState {
  room: RoomSnapshot | null;
  session: UserSession | null;
  connectionStatus: "idle" | "connecting" | "connected" | "error";
  error: string | null;
  chatTypingUsers: TypingParticipant[];
  editorTypingUsers: TypingParticipant[];
  setSession: (session: UserSession | null) => void;
  setRoom: (room: RoomSnapshot | null) => void;
  setConnectionStatus: (status: RoomStoreState["connectionStatus"]) => void;
  setError: (message: string | null) => void;
  setCode: (code: string, version?: number) => void;
  setLanguage: (language: SupportedLanguage) => void;
  replaceParticipants: (participants: Participant[]) => void;
  upsertParticipant: (participant: Participant) => void;
  updateParticipantCursor: (cursor: CursorUpdate) => void;
  setHistory: (history: HistoryEntry[]) => void;
  appendMessage: (message: ChatMessage) => void;
  setChatTypingState: (participant: TypingParticipant, isTyping: boolean) => void;
  setEditorTypingState: (participant: TypingParticipant, isTyping: boolean) => void;
  clearTypingUsers: () => void;
}

export const useRoomStore = create<RoomStoreState>((set) => ({
  room: null,
  session: null,
  connectionStatus: "idle",
  error: null,
  chatTypingUsers: [],
  editorTypingUsers: [],
  setSession: (session) => set({ session }),
  setRoom: (room) =>
    set({
      room,
      chatTypingUsers: [],
      editorTypingUsers: []
    }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setError: (error) => set({ error }),
  setCode: (code, version) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            code,
            version: version ?? state.room.version
          }
        : null
    })),
  setLanguage: (language) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            language
          }
        : null
    })),
  replaceParticipants: (participants) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            participants
          }
        : null
    })),
  upsertParticipant: (participant) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            participants: state.room.participants.some((entry) => entry.userId === participant.userId)
              ? state.room.participants.map((entry) => (entry.userId === participant.userId ? participant : entry))
              : [...state.room.participants, participant]
          }
        : null
    })),
  updateParticipantCursor: (cursor) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            participants: state.room.participants.map((participant) =>
              participant.userId === cursor.userId
                ? {
                    ...participant,
                    username: cursor.username,
                    cursor: {
                      lineNumber: cursor.lineNumber,
                      column: cursor.column
                    }
                  }
                : participant
            )
          }
        : null
    })),
  setHistory: (history) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            history
          }
        : null
    })),
  appendMessage: (message) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            chat: [...state.room.chat, message]
          }
        : null
    })),
  setChatTypingState: (participant, isTyping) =>
    set((state) => ({
      chatTypingUsers: upsertTypingParticipant(state.chatTypingUsers, participant, isTyping)
    })),
  setEditorTypingState: (participant, isTyping) =>
    set((state) => ({
      editorTypingUsers: upsertTypingParticipant(state.editorTypingUsers, participant, isTyping)
    })),
  clearTypingUsers: () =>
    set({
      chatTypingUsers: [],
      editorTypingUsers: []
    })
}));
