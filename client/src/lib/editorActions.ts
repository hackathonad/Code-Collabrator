import type { SupportedLanguage } from "../types/collaboration";
import { copyTextToClipboard } from "./clipboard";
import { getExternalRunnerUrl } from "./externalRunners";

export const copyRoomCode = async (code: string) => {
  await copyTextToClipboard(code);
};

const extensionsByLanguage: Record<SupportedLanguage, string[]> = {
  javascript: ["js", "jsx", "mjs", "cjs", "ts", "tsx"],
  python: ["py", "pyw"],
  cpp: ["cpp", "cc", "cxx", "hpp", "h"]
};

const defaultExtension: Record<SupportedLanguage, string> = { javascript: "js", python: "py", cpp: "cpp" };

export const sourceFilenameForLanguage = (filename: string, language: SupportedLanguage) => {
  const trimmed = filename.trim() || `main.${defaultExtension[language]}`;
  const match = /^(.*?)(?:\.([^.]+))?$/.exec(trimmed);
  const base = match?.[1] || "main";
  const extension = match?.[2]?.toLowerCase();
  return extension && extensionsByLanguage[language].includes(extension)
    ? `${base}.${extension}`
    : `${base}.${defaultExtension[language]}`;
};

export const downloadSourceFile = (code: string, filename: string, language: SupportedLanguage) => {
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = sourceFilenameForLanguage(filename, language);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

interface RunCodeExternallyInput {
  code: string;
  language: SupportedLanguage;
}

export const runCodeExternally = async ({ code, language }: RunCodeExternallyInput) => {
  await copyTextToClipboard(code);
  const opened = window.open(getExternalRunnerUrl(language), "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("The external runner was blocked. Allow pop-ups and try again.");
};
