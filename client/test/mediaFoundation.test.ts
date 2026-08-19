import assert from "node:assert/strict";
import test from "node:test";
import { mediaErrorMessage, mediaPermissionForError } from "../src/lib/media/mediaErrors";
import { canChangeMedia, emptyMediaState, mediaStatusFor } from "../src/lib/media/mediaState";

test("media state stays optional and reports only actual call participants", () => {
  const state = emptyMediaState();
  assert.equal(state.connectionState, "disconnected");
  assert.equal(canChangeMedia(state.connectionState), false);
  const participant = { identity: "room-user", displayName: "Room User", isLocal: true, microphoneEnabled: true, cameraEnabled: false, screenShareEnabled: true, isSpeaking: false, connectionQuality: "good" as const, cameraTrack: null, screenTrack: null, audioTrack: null };
  assert.deepEqual(mediaStatusFor([participant], "room-user"), { inCall: true, microphoneEnabled: true, cameraEnabled: false, screenShareEnabled: true, isSpeaking: false });
  assert.equal(mediaStatusFor([participant], "not-in-call"), null);
  assert.equal(canChangeMedia("connected"), true);
});

test("media permission errors are translated without exposing raw browser errors", () => {
  assert.equal(mediaErrorMessage(Object.assign(new Error("browser raw detail"), { name: "NotAllowedError" }), "microphone"), "Microphone permission was denied.");
  assert.equal(mediaErrorMessage(Object.assign(new Error("cancelled"), { name: "AbortError" }), "screen sharing"), "Screen sharing was cancelled.");
  assert.equal(mediaErrorMessage(Object.assign(new Error("missing"), { name: "NotFoundError" }), "camera"), "No camera was found.");
  assert.equal(mediaPermissionForError(Object.assign(new Error("denied"), { name: "NotAllowedError" })), "denied");
  assert.equal(mediaPermissionForError(Object.assign(new Error("missing"), { name: "NotFoundError" })), "unavailable");
  assert.equal(mediaErrorMessage(Object.assign(new Error("socket detail"), { name: "ConnectionError" }), "call"), "Cannot reach the media server. Check the call setup and try again.");
});
