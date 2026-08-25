import assert from "node:assert/strict";
import test from "node:test";
import { storage } from "../src/lib/storage";
import { useRoomStore } from "../src/store/useRoomStore";
import type { RoomSnapshot } from "../src/types/collaboration";

class FakeStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const withStorage = async (callback: (localStorage: FakeStorage) => Promise<void> | void) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const localStorage = new FakeStorage();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  try { await callback(localStorage); }
  finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as { window?: Window }).window;
  }
};

test("corrupted Quick Rejoin and session storage is ignored safely", async () => {
  await withStorage((localStorage) => {
    localStorage.setItem("code-sphere-recent-rooms", JSON.stringify({ invalid: true }));
    localStorage.setItem("code-sphere-sessions", JSON.stringify(["invalid"]));
    assert.deepEqual(storage.getRecentRooms(), []);
    assert.equal(storage.getSession("deadbeef"), undefined);
  });
});

test("malformed room cache is discarded instead of becoming a fake room", async () => {
  await withStorage((localStorage) => {
    localStorage.setItem("code-sphere-room-cache", JSON.stringify({ deadbeef: { roomId: "deadbeef" } }));
    assert.equal(storage.getRoomSnapshot("deadbeef"), null);
  });
});

const room = (version: number, code: string): RoomSnapshot => ({
  roomId: "deadbeef",
  ownerId: "owner",
  language: "javascript",
  code,
  isPaused: false,
  version,
  createdAt: 1,
  updatedAt: version,
  participants: [],
  chat: [],
  history: [],
  workspace: {
    id: "workspace",
    name: "Room deadbeef",
    ownerId: "owner",
    language: "javascript",
    rootFolderId: "root",
    folders: { root: { id: "root", name: "Room", parentId: null, createdAt: 1, updatedAt: 1, createdByUserId: "owner" } },
    files: { file: { id: "file", name: "main.js", parentId: "root", extension: "js", language: "javascript", content: code, createdAt: 1, updatedAt: 1, createdByUserId: "owner", updatedByUserId: "owner" } },
    openFileIds: ["file"],
    activeFileId: "file",
    recentlyOpenedFileIds: ["file"],
    execution: { entryFileId: "file" },
    git: { repositoryId: null, branch: null },
    ai: { indexedAt: null, contextVersion: 0 },
    trash: [],
    createdAt: 1,
    updatedAt: version
  }
});

test("room state rejects stale snapshots and deduplicates bounded chat/history", async () => {
  await withStorage(() => {
    const store = useRoomStore.getState();
    store.setRoom(room(3, "new"));
    store.setRoom(room(2, "old"));
    assert.equal(useRoomStore.getState().room?.code, "new");
    for (let index = 0; index < 120; index += 1) {
      store.appendMessage({ id: `message-${index}`, userId: "owner", username: "Owner", message: String(index), timestamp: index });
    }
    store.appendMessage({ id: "message-119", userId: "owner", username: "Owner", message: "duplicate", timestamp: 999 });
    store.setHistory(Array.from({ length: 40 }, (_, index) => ({ id: `history-${index}`, roomVersion: index, language: "javascript" as const, code: String(index), createdAt: index, createdByUserId: "owner", createdByUsername: "Owner", reason: "autosave" as const })));
    const current = useRoomStore.getState().room;
    assert.equal(current?.chat.length, 100);
    assert.equal(current?.chat.filter((entry) => entry.id === "message-119").length, 1);
    assert.equal(current?.history.length, 30);
    assert.equal(current?.history[0]?.createdAt, 39);
  });
});
