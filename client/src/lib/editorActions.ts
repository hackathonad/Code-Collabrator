import type { SupportedLanguage } from "../types/collaboration";
import { copyTextToClipboard } from "./clipboard";
import { getExternalRunnerUrl } from "./externalRunners";

export const copyRoomCode = async (code: string) => {
  await copyTextToClipboard(code);
};

interface RunCodeExternallyInput {
  code: string;
  language: SupportedLanguage;
}

export const runCodeExternally = async ({ code, language }: RunCodeExternallyInput) => {
  await copyTextToClipboard(code);
  window.open(getExternalRunnerUrl(language), "_blank", "noopener,noreferrer");
};
