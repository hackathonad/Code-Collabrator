import type { RoomRole } from "./roomTypes";

/**
 * What each role may do in a room. This is the single server-side source of
 * truth; the browser keeps a mirrored copy only to explain disabled controls,
 * and a parity test keeps the two identical. The server enforces every action.
 */
export type RoomAction =
  | "chat"
  | "edit"
  | "manage-content"
  | "use-ai"
  | "approve-patch"
  | "run-checks"
  | "git-local"
  | "git-remote"
  | "github-connect";

const ALL_ACTIONS: readonly RoomAction[] = ["chat", "edit", "manage-content", "use-ai", "approve-patch", "run-checks", "git-local", "git-remote", "github-connect"];
const CONTRIBUTOR_ACTIONS: readonly RoomAction[] = ["chat", "edit", "manage-content", "use-ai", "run-checks", "git-local"];

export const ROLE_PERMISSIONS: Readonly<Record<RoomRole, readonly RoomAction[]>> = {
  owner: ALL_ACTIONS,
  moderator: ALL_ACTIONS,
  // Trusted collaborators may approve AI patches and write to the remote repository.
  member: [...CONTRIBUTOR_ACTIONS, "approve-patch", "git-remote"],
  // Anyone who joins by link. They can work and ask the AI, and approve patches they requested themselves.
  guest: CONTRIBUTOR_ACTIONS,
  // Read-only: can follow along and chat.
  viewer: ["chat"]
};

export const ROOM_ROLES = Object.keys(ROLE_PERMISSIONS) as RoomRole[];

export const can = (role: RoomRole | undefined, action: RoomAction) => Boolean(role && ROLE_PERMISSIONS[role]?.includes(action));

/** A patch may be approved by trusted roles, or by the collaborator who requested the AI task that produced it. */
export const canApprovePatch = (role: RoomRole | undefined, userId: string, requesterUserId?: string) =>
  can(role, "approve-patch") || (Boolean(requesterUserId) && requesterUserId === userId && can(role, "use-ai"));

const DENIED_MESSAGES: Record<RoomAction, string> = {
  chat: "Your role cannot send messages in this room.",
  edit: "Your role in this room is read-only.",
  "manage-content": "Your role in this room cannot change files.",
  "use-ai": "Your role in this room cannot use the AI teammate. Ask the room owner to change your role.",
  "approve-patch": "Only the owner, moderators, members, or the person who requested the task can approve this AI patch.",
  "run-checks": "Your role in this room cannot run project checks.",
  "git-local": "Your role in this room cannot change Git state.",
  "git-remote": "Writing to the remote repository needs the member role or higher. Ask the room owner to change your role.",
  "github-connect": "Only the room owner or a moderator can connect GitHub for this room."
};

export const permissionDeniedMessage = (action: RoomAction) => DENIED_MESSAGES[action];
