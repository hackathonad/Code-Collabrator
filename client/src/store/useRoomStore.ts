import { create } from "zustand";
import type { ChatMessage, CursorUpdate, HistoryEntry, Participant, RoomSnapshot, SupportedLanguage, TypingParticipant, UserSession, WorkspaceState } from "../types/collaboration";
import { storage } from "../lib/storage";

const upsertTypingParticipant = (participants: TypingParticipant[], participant: TypingParticipant, isTyping: boolean) => {
  if (!isTyping) {
    return participants.filter((entry) => entry.userId !== participant.userId);
  }

  return participants.some((entry) => entry.userId === participant.userId)
    ? participants.map((entry) => (entry.userId === participant.userId ? participant : entry))
    : [...participants, participant];
};


const persistRoomBestEffort = (room: RoomSnapshot | null) => {
  if (!room) {
    return;
  }

  storage.saveRoomSnapshot(room);
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
  setCode: (code: string, version?: number, fileId?: string) => void;
  setLanguage: (language: SupportedLanguage, fileId?: string) => void;
  syncWorkspace: (workspace: WorkspaceState, code: string, language: SupportedLanguage, version: number, history: HistoryEntry[]) => void;
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
  setRoom: (room) => {
    set({
      room,
      chatTypingUsers: [],
      editorTypingUsers: []
    });

    persistRoomBestEffort(room);
  },
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setError: (error) => set({ error }),
  setCode: (code, version, fileId) =>
    set((state) => {
      if (!state.room) return { room: null };
      const targetFileId = fileId ?? state.room.workspace.activeFileId;
      const activeFile = state.room.workspace.files[targetFileId];
      const workspace = activeFile
        ? { ...state.room.workspace, files: { ...state.room.workspace.files, [targetFileId]: { ...activeFile, content: code } } }
        : state.room.workspace;
      const room = { ...state.room, workspace, code, version: version ?? state.room.version };
      persistRoomBestEffort(room);
      return { room };
    }),
  setLanguage: (language, fileId) =>
    set((state) => {
      if (!state.room) return { room: null };
      const targetFileId = fileId ?? state.room.workspace.activeFileId;
      const activeFile = state.room.workspace.files[targetFileId];
      const workspace = activeFile
        ? { ...state.room.workspace, language, files: { ...state.room.workspace.files, [targetFileId]: { ...activeFile, language } } }
        : state.room.workspace;
      const room = { ...state.room, workspace, language };
      persistRoomBestEffort(room);
      return { room };
    }),
  syncWorkspace: (workspace, code, language, version, history) =>
    set((state) => {
      const room = state.room ? { ...state.room, workspace, code, language, version, history } : null;
      persistRoomBestEffort(room);
      return { room };
    }),
  replaceParticipants: (participants) =>
    set((state) => {
      const room = state.room
        ? {
            ...state.room,
            participants
          }
        : null;
      persistRoomBestEffort(room);
      return { room };
    }),
  upsertParticipant: (participant) =>
    set((state) => {
      const room = state.room
        ? {
            ...state.room,
            participants: state.room.participants.some((entry) => entry.userId === participant.userId)
              ? state.room.participants.map((entry) => (entry.userId === participant.userId ? participant : entry))
              : [...state.room.participants, participant]
          }
        : null;
      persistRoomBestEffort(room);
      return { room };
    }),
  updateParticipantCursor: (cursor) =>
    set((state) => {
      const room = state.room
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
        : null;
      persistRoomBestEffort(room);
      return { room };
    }),
  setHistory: (history) =>
    set((state) => {
      const room = state.room
        ? {
            ...state.room,
            history
          }
        : null;
      persistRoomBestEffort(room);
      return { room };
    }),
  appendMessage: (message) =>
    set((state) => {
      const room = state.room
        ? {
            ...state.room,
            chat: state.room.chat.some((entry) => entry.id === message.id) ? state.room.chat : [...state.room.chat, message]
          }
        : null;
      persistRoomBestEffort(room);
      return { room };
    }),
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
