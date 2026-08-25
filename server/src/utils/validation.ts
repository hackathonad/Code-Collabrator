import { supportedLanguages, type SupportedLanguage } from "../constants/languages";
import type { CursorState, RoomRole } from "../modules/rooms/roomTypes";

const ROOM_ID_PATTERN = /^[a-f0-9]{8}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_USERNAME_LENGTH = 24;
export const MAX_CHAT_MESSAGE_LENGTH = 1_000;
export const MAX_CODE_LENGTH = 500_000;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const sanitizeUsername = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_USERNAME_LENGTH);

export const sanitizeMessage = (value: unknown) =>
  String(value ?? "")
    .trim()
    .slice(0, MAX_CHAT_MESSAGE_LENGTH);

export const sanitizeRoomId = (value: unknown) => {
  const roomId = String(value ?? "").trim().toLowerCase();
  return ROOM_ID_PATTERN.test(roomId) ? roomId : "";
};

export const sanitizeUserId = (value: unknown) => {
  const userId = String(value ?? "").trim();
  return UUID_PATTERN.test(userId) ? userId : "";
};

export const sanitizeLanguage = (value: unknown): SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage) ? (value as SupportedLanguage) : "javascript";

export const isSupportedLanguage = (value: unknown): value is SupportedLanguage =>
  typeof value === "string" && supportedLanguages.includes(value as SupportedLanguage);

export const isEditableRole = (value: unknown): value is Exclude<RoomRole, "owner"> =>
  value === "moderator" || value === "member" || value === "guest";

export const sanitizeBoolean = (value: unknown) => value === true;

export const sanitizeCode = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  return value.length <= MAX_CODE_LENGTH ? value : null;
};

export const sanitizeCursor = (value: unknown): CursorState | null => {
  if (!isRecord(value)) {
    return null;
  }

  const lineNumber = Number(value.lineNumber);
  const column = Number(value.column);

  if (!Number.isInteger(lineNumber) || !Number.isInteger(column)) {
    return null;
  }

  return {
    lineNumber: Math.min(Math.max(lineNumber, 1), 100_000),
    column: Math.min(Math.max(column, 1), 10_000)
  };
};

