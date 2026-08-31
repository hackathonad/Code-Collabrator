import { create } from "zustand";
import type { ExecutionAction, ExecutionCapabilities, ExecutionRecord } from "../types/execution";
import type { UserSession } from "../types/collaboration";
import { api } from "../lib/api";

const MAX_RECORDS = 40;

interface ExecutionStoreState {
  roomId: string | null;
  workspaceId: string | null;
  records: ExecutionRecord[];
  capabilities: ExecutionCapabilities | null;
  activeExecutionId: string | null;
  loading: boolean;
  error: string | null;
  initialize: (roomId: string, workspaceId: string, session: UserSession) => Promise<void>;
  hydrate: (roomId: string, workspaceId: string, records: ExecutionRecord[]) => void;
  receive: (record: ExecutionRecord) => void;
  start: (roomId: string, workspaceId: string, session: UserSession, action: ExecutionAction, target?: string) => Promise<ExecutionRecord>;
  cancel: (roomId: string, workspaceId: string, session: UserSession, executionId: string) => Promise<void>;
  clear: () => void;
}

const sortRecords = (records: ExecutionRecord[]) => [...records].sort((left, right) => right.createdAt - left.createdAt).slice(0, MAX_RECORDS);

export const useExecutionStore = create<ExecutionStoreState>((set, get) => ({
  roomId: null,
  workspaceId: null,
  records: [],
  capabilities: null,
  activeExecutionId: null,
  loading: false,
  error: null,
  initialize: async (roomId, workspaceId, session) => {
    set({ roomId, workspaceId, loading: true, error: null });
    try {
      const [capabilities, records] = await Promise.all([api.getExecutionCapabilities(roomId, session), api.getExecutionHistory(roomId, session)]);
      if (get().roomId === roomId && get().workspaceId === workspaceId) set({ capabilities, records: sortRecords(records), loading: false });
    } catch (error) {
      if (get().roomId === roomId && get().workspaceId === workspaceId) set({ loading: false, error: error instanceof Error ? error.message : "Execution tools are unavailable." });
    }
  },
  hydrate: (roomId, workspaceId, records) => set((state) => {
    if (state.roomId && (state.roomId !== roomId || state.workspaceId !== workspaceId)) return state;
    const scopedRecords = records.filter((record) => record.roomId === roomId && record.workspaceId === workspaceId);
    return {
      roomId,
      workspaceId,
      records: sortRecords(scopedRecords),
      activeExecutionId: scopedRecords.find((record) => record.status === "queued" || record.status === "running")?.executionId ?? null,
      loading: false,
      error: null
    };
  }),
  receive: (record) => set((state) => {
    if (state.roomId !== record.roomId || state.workspaceId !== record.workspaceId) return state;
    const records = state.records.some((entry) => entry.executionId === record.executionId)
      ? state.records.map((entry) => entry.executionId === record.executionId && entry.createdAt <= record.createdAt ? record : entry)
      : [record, ...state.records];
    return { records: sortRecords(records), activeExecutionId: record.status === "queued" || record.status === "running" ? record.executionId : state.activeExecutionId === record.executionId ? null : state.activeExecutionId };
  }),
  start: async (roomId, workspaceId, session, action, target) => {
    set({ error: null });
    const record = await api.startExecution(roomId, session, { action, target, requestId: crypto.randomUUID() });
    get().receive(record);
    return record;
  },
  cancel: async (roomId, workspaceId, session, executionId) => {
    const record = await api.cancelExecution(roomId, session, executionId);
    if (record.workspaceId === workspaceId) get().receive(record);
  },
  clear: () => set({ roomId: null, workspaceId: null, records: [], capabilities: null, activeExecutionId: null, loading: false, error: null })
}));
