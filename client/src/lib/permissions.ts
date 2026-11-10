import type { RoomRole } from "../types/collaboration";

/**
 * Mirror of server/src/modules/rooms/roomPermissions.ts, used only to explain
 * disabled controls. The server enforces every action; a parity test keeps
 * this table identical to the server's.
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
  member: [...CONTRIBUTOR_ACTIONS, "approve-patch", "git-remote"],
  guest: CONTRIBUTOR_ACTIONS,
  viewer: ["chat"]
};

export const can = (role: RoomRole | undefined, action: RoomAction) => Boolean(role && ROLE_PERMISSIONS[role]?.includes(action));
