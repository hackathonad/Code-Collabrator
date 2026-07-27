import type { SupportedLanguage } from "../types/collaboration";

const runnerUrls: Record<SupportedLanguage, string> = {
  javascript: "https://www.programiz.com/javascript/online-compiler/",
  python: "https://www.programiz.com/python-programming/online-compiler/",
  cpp: "https://www.programiz.com/cpp-programming/online-compiler/"
};

export const DEFAULT_EXTERNAL_COMPILER = "Programiz";

export const getExternalRunnerUrl = (language: SupportedLanguage) => runnerUrls[language];
