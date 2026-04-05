import { env } from "../../config/env";
import { LANGUAGE_CONFIG, type SupportedLanguage } from "../../constants/languages";

interface ExecuteCodeInput {
  language: SupportedLanguage;
  code: string;
}

interface PistonResponse {
  run?: {
    output?: string;
    stderr?: string;
    stdout?: string;
    code?: number;
    signal?: string;
  };
  compile?: {
    output?: string;
    stderr?: string;
    stdout?: string;
    code?: number;
  };
}

export interface ExecutionResult {
  output: string;
  error: string | null;
  language: SupportedLanguage;
}

export const executeCode = async ({ language, code }: ExecuteCodeInput): Promise<ExecutionResult> => {
  const config = LANGUAGE_CONFIG[language];

  const response = await fetch(env.pistonUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      language: config.pistonRuntime,
      version: config.version,
      files: [
        {
          name: `main.${config.extension}`,
          content: code
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error("Execution provider is unavailable right now");
  }

  const payload = (await response.json()) as PistonResponse;
  const compileError = payload.compile?.stderr || payload.compile?.output || null;
  const runtimeError = payload.run?.stderr || null;

  return {
    language,
    output: payload.run?.stdout || payload.run?.output || "",
    error: compileError || runtimeError
  };
};

