import { Router } from "express";
import { supportedLanguages, type SupportedLanguage } from "../constants/languages";
import { roomStore } from "../modules/rooms/roomStore";

const router = Router();

const sanitizeUsername = (value: unknown) => String(value ?? "").trim().slice(0, 24);
const sanitizeLanguage = (value: unknown): SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage) ? (value as SupportedLanguage) : "javascript";

router.post("/", (request, response) => {
  const username = sanitizeUsername(request.body?.username);
  const language = sanitizeLanguage(request.body?.language);

  if (!username) {
    response.status(400).json({
      message: "Username is required"
    });
    return;
  }

  const created = roomStore.createRoom(username, language);
  response.status(201).json(created);
});

router.post("/:roomId/join", (request, response) => {
  const username = sanitizeUsername(request.body?.username);
  const userId = typeof request.body?.userId === "string" ? request.body.userId : undefined;

  if (!username) {
    response.status(400).json({
      message: "Username is required"
    });
    return;
  }

  try {
    const joined = roomStore.joinRoom(request.params.roomId, username, userId);
    response.json(joined);
  } catch (error) {
    response.status(404).json({
      message: error instanceof Error ? error.message : "Unable to join room"
    });
  }
});

router.get("/:roomId", (request, response) => {
  try {
    response.json(roomStore.getRoomSnapshot(request.params.roomId));
  } catch (error) {
    response.status(404).json({
      message: error instanceof Error ? error.message : "Room not found"
    });
  }
});

router.get("/:roomId/history", (request, response) => {
  try {
    response.json(roomStore.getRoomSnapshot(request.params.roomId).history);
  } catch (error) {
    response.status(404).json({
      message: error instanceof Error ? error.message : "Room not found"
    });
  }
});

router.post("/:roomId/history/:historyId/restore", (request, response) => {
  const userId = String(request.body?.userId ?? "");

  if (!userId) {
    response.status(400).json({
      message: "User ID is required"
    });
    return;
  }

  try {
    const restored = roomStore.restoreHistoryEntry(request.params.roomId, userId, request.params.historyId);
    response.json(restored);
  } catch (error) {
    response.status(403).json({
      message: error instanceof Error ? error.message : "Unable to restore room history"
    });
  }
});

router.delete("/:roomId", (request, response) => {
  const userId = String(request.query.userId ?? "");

  try {
    roomStore.deleteRoom(request.params.roomId, userId);
    response.status(204).send();
  } catch (error) {
    response.status(403).json({
      message: error instanceof Error ? error.message : "Unable to delete room"
    });
  }
});

export default router;
