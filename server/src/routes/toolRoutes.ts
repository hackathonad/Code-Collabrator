import { Router } from "express";
import { supportedLanguages, type SupportedLanguage } from "../constants/languages";
import { analyzeCode, type AiAction } from "../modules/ai/aiService";
import { executeCode } from "../modules/execution/executionService";

const router = Router();

const sanitizeLanguage = (value: unknown): SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage) ? (value as SupportedLanguage) : "javascript";

router.post("/execute", async (request, response) => {
  const code = String(request.body?.code ?? "");
  const language = sanitizeLanguage(request.body?.language);

  if (!code.trim()) {
    response.status(400).json({
      message: "Code is required"
    });
    return;
  }

  try {
    const result = await executeCode({
      code,
      language
    });

    response.json(result);
  } catch (error) {
    response.status(502).json({
      message: error instanceof Error ? error.message : "Execution failed"
    });
  }
});

router.post("/ai", async (request, response) => {
  const code = String(request.body?.code ?? "");
  const language = sanitizeLanguage(request.body?.language);
  const action = request.body?.action === "predict" ? "predict" : "explain";

  if (!code.trim()) {
    response.status(400).json({
      message: "Code is required"
    });
    return;
  }

  try {
    const result = await analyzeCode({
      action: action as AiAction,
      code,
      language
    });

    response.json(result);
  } catch (error) {
    response.status(500).json({
      message: error instanceof Error ? error.message : "AI analysis failed"
    });
  }
});

export default router;

