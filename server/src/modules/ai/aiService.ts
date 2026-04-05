import { env } from "../../config/env";
import type { SupportedLanguage } from "../../constants/languages";

export type AiAction = "predict" | "explain";

interface AnalyzeCodeInput {
  action: AiAction;
  code: string;
  language: SupportedLanguage;
}

const buildFallbackInsight = ({ action, code, language }: AnalyzeCodeInput) => {
  const lineCount = code.split("\n").length;
  const hasLoops = /\b(for|while)\b/.test(code);
  const hasFunctions = /\b(function|def|main\s*\(|=>)\b/.test(code);

  if (action === "predict") {
    return [
      `AI fallback mode is active because \`OPENAI_API_KEY\` is not configured.`,
      `The ${language} snippet has ${lineCount} lines${hasFunctions ? ", at least one function" : ""}${hasLoops ? ", and looping logic" : ""}.`,
      "Use the Run Code button for actual execution output, or add an OpenAI API key to enable richer output prediction."
    ].join("\n\n");
  }

  return [
    `AI fallback mode is active because \`OPENAI_API_KEY\` is not configured.`,
    `This ${language} snippet spans ${lineCount} lines${hasFunctions ? " and defines reusable logic" : ""}${hasLoops ? " with iterative flow" : ""}.`,
    "Use this endpoint with an OpenAI API key to get a full natural-language explanation of control flow, data handling, and likely edge cases."
  ].join("\n\n");
};

const buildPrompt = ({ action, code, language }: AnalyzeCodeInput) => {
  const objective =
    action === "predict"
      ? "Predict the most likely console output of the code without executing it. Mention uncertainty if the output depends on runtime behavior or external state."
      : "Explain the code clearly for a collaborating developer. Focus on purpose, flow, major constructs, and likely pitfalls.";

  return `${objective}

Language: ${language}

Code:
\`\`\`${language}
${code}
\`\`\`
`;
};

export const analyzeCode = async (input: AnalyzeCodeInput) => {
  if (!env.openAiApiKey) {
    return {
      mode: "fallback" as const,
      result: buildFallbackInsight(input)
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.openAiApiKey}`
    },
    body: JSON.stringify({
      model: env.openAiModel,
      input: buildPrompt(input)
    })
  });

  if (!response.ok) {
    return {
      mode: "fallback" as const,
      result: buildFallbackInsight(input)
    };
  }

  const payload = (await response.json()) as {
    output_text?: string;
  };

  return {
    mode: "ai" as const,
    result: payload.output_text ?? buildFallbackInsight(input)
  };
};

