import type { PropsWithChildren } from "react";
import { PanelContainer } from "./PanelContainer";

interface PanelProps extends PropsWithChildren {
  className?: string;
}

export const Panel = ({ className = "", children }: PanelProps) => (
  <PanelContainer className={`motion-surface ${className}`.trim()} padding="md">
    {children}
  </PanelContainer>
);
