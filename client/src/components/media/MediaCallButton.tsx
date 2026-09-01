import { LoaderCircle, Phone, PhoneOff } from "lucide-react";
import { useMediaStore } from "../../store/useMediaStore";
import { ToolbarButton } from "../ui/ToolbarButton";

export const MediaCallButton = ({ onOpenPanel }: { onOpenPanel: () => void }) => {
  const connectionState = useMediaStore((state) => state.connectionState);
  const connecting = connectionState === "connecting" || connectionState === "reconnecting";
  const active = connectionState === "connected" || connectionState === "reconnecting";
  const onClick = () => onOpenPanel();
  return <ToolbarButton label={active ? "Call controls" : connecting ? "Joining call" : "Join call"} icon={connecting ? <LoaderCircle className="animate-spin" /> : active ? <PhoneOff /> : <Phone />} onClick={onClick} disabled={connecting} accent={active} />;
};
