import { create } from "zustand";
import type { AiResult, ChatMessage, ExecutionResult, Participant, RoomSnapshot, SupportedLanguage, UserSession } from "../types/collaboration";

interface RoomStoreState {
  room: RoomSnapshot | null;
  session: UserSession | null;
  connectionStatus: "idle" | "connecting" | "connected" | "error";
  error: string | null;
  execution: {
    loading: boolean;
    result: ExecutionResult | null;
  };
  ai: {
    loading: boolean;
    result: AiResult | null;
  };
  setSession: (session: UserSession | null) => void;
  setRoom: (room: RoomSnapshot | null) => void;
  setConnectionStatus: (status: RoomStoreState["connectionStatus"]) => void;
  setError: (message: string | null) => void;
  setCode: (code: string, version?: number) => void;
  setLanguage: (language: SupportedLanguage) => void;
  replaceParticipants: (participants: Participant[]) => void;
  upsertParticipant: (participant: Participant) => void;
  appendMessage: (message: ChatMessage) => void;
  setExecutionLoading: (loading: boolean) => void;
  setExecutionResult: (result: ExecutionResult | null) => void;
  setAiLoading: (loading: boolean) => void;
  setAiResult: (result: AiResult | null) => void;
}

export const useRoomStore = create<RoomStoreState>((set) => ({
  room: null,
  session: null,
  connectionStatus: "idle",
  error: null,
  execution: {
    loading: false,
    result: null
  },
  ai: {
    loading: false,
    result: null
  },
  setSession: (session) => set({ session }),
  setRoom: (room) => set({ room }),
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
  appendMessage: (message) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            chat: [...state.room.chat, message]
          }
        : null
    })),
  setExecutionLoading: (loading) =>
    set((state) => ({
      execution: {
        ...state.execution,
        loading
      }
    })),
  setExecutionResult: (result) =>
    set({
      execution: {
        loading: false,
        result
      }
    }),
  setAiLoading: (loading) =>
    set((state) => ({
      ai: {
        ...state.ai,
        loading
      }
    })),
  setAiResult: (result) =>
    set({
      ai: {
        loading: false,
        result
      }
    })
}));
