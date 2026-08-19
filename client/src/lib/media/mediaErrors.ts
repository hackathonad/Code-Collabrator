export const mediaErrorMessage = (error: unknown, action = "media") => {
  const name = error instanceof Error ? error.name : "";
  if (action === "call" && (name === "ConnectionError" || name === "WebSocketError" || name === "")) return "Cannot reach the media server. Check the call setup and try again.";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return `${action[0].toUpperCase() + action.slice(1)} permission was denied.`;
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return `No ${action === "camera" ? "camera" : action === "microphone" ? "microphone" : "compatible media device"} was found.`;
  if (name === "AbortError") return action === "screen sharing" ? "Screen sharing was cancelled." : `${action[0].toUpperCase() + action.slice(1)} was cancelled.`;
  if (name === "NotReadableError" || name === "TrackInvalidError") return `The selected ${action} is unavailable or already in use.`;
  if (name === "DeviceUnsupportedError") return `This browser does not support ${action}.`;
  return `Unable to enable ${action}. Please try again.`;
};

export const mediaPermissionForError = (error: unknown) => {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied" as const;
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "NotReadableError" || name === "TrackInvalidError") return "unavailable" as const;
  if (name === "DeviceUnsupportedError") return "unsupported" as const;
  return "unknown" as const;
};
