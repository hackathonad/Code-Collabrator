export type SupportedLanguage = "javascript" | "python" | "cpp";
export type RoomRole = "owner" | "moderator" | "member" | "guest";
export type UserIdentityKind = "guest";
export type ParticipantAccent = "blue" | "emerald" | "amber" | "rose" | "violet" | "cyan";
export type PresenceStatus = "active" | "idle" | "offline";
export type RoomActivityKind = "room" | "presence" | "file" | "agent" | "patch" | "validation" | "git" | "chat";

export interface RoomActivityEntry {
  id: string;
  roomId: string;
  actorId?: string;
  actorName: string;
  kind: RoomActivityKind;
  message: string;
  createdAt: number;
  taskId?: string;
  fileId?: string;
}

export interface CursorState {
  lineNumber: number;
  column: number;
}

export interface CursorUpdate {
  userId: string;
  username: string;
  lineNumber: number;
  column: number;
}

export interface Participant {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  identityKind: UserIdentityKind;
  role: RoomRole;
  accent: ParticipantAccent;
  joinedAt: number;
  isOnline: boolean;
  status: PresenceStatus;
  lastActiveAt: number;
  cursor: CursorState;
  editsCount: number;
  timeSpentMs: number;
  activeFileId?: string;
  activeFileName?: string;
  activity?: string;
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

export type WorkspaceNodeKind = "file" | "folder";

export interface WorkspaceFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  createdByUserId: string;
}

export interface WorkspaceFile {
  id: string;
  name: string;
  parentId: string;
  extension: string;
  language: SupportedLanguage;
  content: string;
  createdAt: number;
  updatedAt: number;
  createdByUserId: string;
  updatedByUserId: string;
}

export interface WorkspaceTrashEntry {
  id: string;
  kind: WorkspaceNodeKind;
  deletedAt: number;
  deletedByUserId: string;
  files: WorkspaceFile[];
  folders: WorkspaceFolder[];
}

export type WorkspaceOperationType = "create-file" | "create-folder" | "rename" | "delete" | "duplicate-file" | "move" | "copy" | "paste" | "restore-file" | "set-active-file" | "set-open-files" | "set-file-language";

export interface WorkspaceOperation {
  id: string;
  type: WorkspaceOperationType;
  nodeId?: string;
  parentId?: string;
  name?: string;
  sourceId?: string;
  targetParentId?: string;
  fileIds?: string[];
  language?: SupportedLanguage;
}

export interface WorkspaceState {
  id: string;
  name: string;
  ownerId: string;
  language: SupportedLanguage;
  rootFolderId: string;
  folders: Record<string, WorkspaceFolder>;
  files: Record<string, WorkspaceFile>;
  openFileIds: string[];
  activeFileId: string;
  recentlyOpenedFileIds: string[];
  execution: { entryFileId: string | null };
  git: { repositoryId: string | null; branch: string | null; provider?: "github" | "gitlab" | "bitbucket" | "azure-devops" | "local" | "unknown" | null; repositoryRootId?: string | null };
  ai: { indexedAt: number | null; contextVersion: number };
  trash: WorkspaceTrashEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  roomVersion: number;
  language: SupportedLanguage;
  code: string;
  createdAt: number;
  createdByUserId: string;
  createdByUsername: string;
  reason: HistoryReason;
  workspaceOperation?: WorkspaceOperationType;
  fileId?: string;
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
  participants: Participant[];
  chat: ChatMessage[];
  history: HistoryEntry[];
  activity: RoomActivityEntry[];
  workspace: WorkspaceState;
}

export interface UserSession {
  roomId: string;
  userId: string;
  username: string;
  identityKind: UserIdentityKind;
  guestToken?: string;
}

export interface TypingParticipant {
  userId: string;
  username: string;
}

export interface RecentRoom {
  roomId: string;
  label: string;
  username: string;
  lastVisitedAt: number;
}
