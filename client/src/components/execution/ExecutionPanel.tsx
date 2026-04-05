import { Bot, Play, WandSparkles } from "lucide-react";
import { api } from "../../lib/api";
import { useRoomStore } from "../../store/useRoomStore";
import type { AiAction, SupportedLanguage } from "../../types/collaboration";
import { Panel } from "../ui/Panel";

interface ExecutionPanelProps {
  code: string;
  language: SupportedLanguage;
}

export const ExecutionPanel = ({ code, language }: ExecutionPanelProps) => {
  const { execution, ai, setExecutionLoading, setExecutionResult, setAiLoading, setAiResult, setError } = useRoomStore();

  const runCode = async () => {
    try {
      setExecutionLoading(true);
      const result = await api.executeCode(code, language);
      setExecutionResult(result);
    } catch (error) {
      setExecutionResult({
        output: "",
        error: error instanceof Error ? error.message : "Execution failed",
        language
      });
    }
  };

  const runAi = async (action: AiAction) => {
    try {
      setAiLoading(true);
      const result = await api.analyzeCode(code, language, action);
      setAiResult(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "AI analysis failed");
      setAiResult({
        mode: "fallback",
        result: "AI analysis is unavailable right now."
      });
    }
  };

  return (
    <Panel className="flex min-h-[320px] flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-sky-300/80">Execution + AI</p>
          <h3 className="font-display text-xl text-white">Runtime intelligence</h3>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
          {language}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={runCode}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300"
        >
          <Play className="h-4 w-4" />
          {execution.loading ? "Running..." : "Run Code"}
        </button>
        <button
          type="button"
          onClick={() => runAi("predict")}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 font-semibold text-sky-100 transition hover:bg-sky-400/20"
        >
          <WandSparkles className="h-4 w-4" />
          {ai.loading ? "Working..." : "Predict Output"}
        </button>
        <button
          type="button"
          onClick={() => runAi("explain")}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-violet-400/30 bg-violet-400/10 px-4 py-3 font-semibold text-violet-100 transition hover:bg-violet-400/20"
        >
          <Bot className="h-4 w-4" />
          Explain Code
        </button>
      </div>

      <div className="grid flex-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-surface-900/90 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Console</p>
          <pre className="mt-3 min-h-[200px] whitespace-pre-wrap font-mono text-sm leading-6 text-slate-100">
            {execution.result?.error
              ? execution.result.error
              : execution.result?.output || "Run the current room code to see stdout and errors here."}
          </pre>
        </div>

        <div className="rounded-2xl border border-white/10 bg-surface-900/90 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">AI Assistant</p>
          <pre className="mt-3 min-h-[200px] whitespace-pre-wrap font-mono text-sm leading-6 text-slate-100">
            {ai.result?.result || "Use Predict Output or Explain Code for a non-executing AI analysis layer."}
          </pre>
        </div>
      </div>
    </Panel>
  );
};
