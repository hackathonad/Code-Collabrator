import { LoaderCircle, Phone, PhoneOff } from "lucide-react";
import type { UserSession } from "../../types/collaboration";
import { useMediaStore } from "../../store/useMediaStore";
import { ToolbarButton } from "../ui/ToolbarButton";

export const MediaCallButton = ({ roomId, session, onOpenPanel }: { roomId: string; session: UserSession; onOpenPanel: () => void }) => {
  const connectionState = useMediaStore((state) => state.connectionState);
  const join = useMediaStore((state) => state.join);
  const connecting = connectionState === "connecting" || connectionState === "reconnecting";
  const active = connectionState === "connected" || connectionState === "reconnecting";
  const onClick = () => {
    onOpenPanel();
    if (active) return;
    void join(roomId, session);
  };
  return <ToolbarButton label={active ? "Call controls" : connecting ? "Joining call" : "Join call"} icon={connecting ? <LoaderCircle className="animate-spin" /> : active ? <PhoneOff /> : <Phone />} onClick={onClick} disabled={connecting} accent={active} />;
};
