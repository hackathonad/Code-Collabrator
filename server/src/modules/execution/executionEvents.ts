import type { ExecutionEvent, ExecutionRecord } from "./executionTypes";

const listeners = new Set<(event: ExecutionEvent) => void>();
const records = new Map<string, ExecutionRecord>();

export const subscribeExecution = (listener: (event: ExecutionEvent) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const publishExecution = (type: ExecutionEvent["type"], record: ExecutionRecord) => {
  const event = { type, record: { ...record } } satisfies ExecutionEvent;
  records.set(record.executionId, { ...record });
  for (const listener of listeners) listener(event);
};

export const getExecution = (executionId: string) => records.get(executionId) ?? null;

export const clearExecutionRoom = (roomId: string) => {
  for (const [executionId, record] of records) if (record.roomId === roomId) records.delete(executionId);
};

export const clearExecutionEvents = () => {
  records.clear();
  listeners.clear();
};
