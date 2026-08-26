import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as MonacoEditor from "monaco-editor";
import type { MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import { useTheme } from "../../context/ThemeContext";
import { useRoomStore } from "../../store/useRoomStore";
import type { Participant, TypingParticipant, UserSession } from "../../types/collaboration";
import type { AIAction } from "../../types/ai";
import type { AgentDiagnostic } from "../../types/agent";
import { EditorToolbar } from "./EditorToolbar";
import { configureMonaco } from "./monacoSetup";

interface CollaborativeEditorProps {
  code: string;
  language: "javascript" | "python" | "cpp";
  participants: Participant[];
  editorTypingUsers: TypingParticipant[];
  session: UserSession;
  roomId: string;
  fileId: string;
  openFileIds: string[];
  socketRef: MutableRefObject<Socket | null>;
  onChangeLanguage: (language: "javascript" | "python" | "cpp") => void;
  isPaused: boolean;
  onSelectionChange?: (selection: { fileId: string; code: string; startOffset: number; endOffset: number } | null) => void;
  onDiagnosticsChange?: (diagnostics: AgentDiagnostic[]) => void;
  onOpenAIAssistant?: (action?: AIAction) => void;
  onEditorAIReady?: (actions: { insertAtCursor: (code: string) => boolean; replaceSelection: (selection: { fileId: string; code: string; startOffset: number; endOffset: number }, code: string) => boolean; replaceFile: (code: string) => boolean }) => void;
}

const languageMap = {
  javascript: "javascript",
  python: "python",
  cpp: "cpp"
} as const;

export const CollaborativeEditor = ({
  code,
  language,
  participants,
  editorTypingUsers,
  session,
  roomId,
  fileId,
  openFileIds,
  socketRef,
  onChangeLanguage,
  isPaused,
  onSelectionChange,
  onDiagnosticsChange,
  onOpenAIAssistant,
  onEditorAIReady
}: CollaborativeEditorProps) => {
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const fileIdRef = useRef(fileId);
  const ignoreSyncRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const cursorDebounceRef = useRef<number | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const disposablesRef = useRef<MonacoEditor.IDisposable[]>([]);
  const lastCursorRef = useRef("1:1");
  const typingRef = useRef(false);
  const lastSelectionRef = useRef("");
  const [hasSelection, setHasSelection] = useState(false);
  const { setCode } = useRoomStore();
  const { editorColorMode } = useTheme();

  useEffect(() => {
    fileIdRef.current = fileId;
  }, [fileId]);

  const currentUser = participants.find((participant) => participant.userId === session.userId);
  const canEdit = Boolean(currentUser) && !isPaused;

  const remoteParticipants = useMemo(
    () => participants.filter((participant) => participant.userId !== session.userId && participant.isOnline),
    [participants, session.userId]
  );

  const visibleTypingUsers = useMemo(
    () => editorTypingUsers.filter((participant) => participant.userId !== session.userId),
    [editorTypingUsers, session.userId]
  );

  const emitEditorTyping = (isTyping: boolean) => {
    if (typingRef.current === isTyping) {
      return;
    }

    typingRef.current = isTyping;
    socketRef.current?.emit("editor:typing", {
      roomId,
      userId: session.userId,
      isTyping
    });
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    configureMonaco(monaco);
    monaco.editor.setTheme(editorColorMode === "light" ? "code-sphere-light" : "code-sphere-dark");
    const updateDiagnostics = () => {
      const model = editor.getModel();
      const diagnostics = model ? monaco.editor.getModelMarkers({ resource: model.uri }).slice(0, 50).map((marker) => ({
        fileId: fileIdRef.current,
        message: marker.message.slice(0, 600),
        severity: marker.severity === 8 ? "error" : marker.severity === 4 ? "warning" : marker.severity === 2 ? "info" : "hint",
        startLine: marker.startLineNumber,
        startColumn: marker.startColumn,
        endLine: marker.endLineNumber,
        endColumn: marker.endColumn
      } satisfies AgentDiagnostic)) : [];
      onDiagnosticsChange?.(diagnostics);
    };
    onEditorAIReady?.({
      insertAtCursor: (nextCode) => {
        const model = editor.getModel(); const position = editor.getPosition();
        if (!model || !position) return false;
        editor.executeEdits("ai-assistant", [{ range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: nextCode, forceMoveMarkers: true }]);
        editor.focus(); return true;
      },
      replaceSelection: (selection, nextCode) => {
        const model = editor.getModel();
        if (!model || selection.fileId !== fileIdRef.current) return false;
        const start = model.getPositionAt(selection.startOffset); const end = model.getPositionAt(selection.endOffset); const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
        if (model.getValueInRange(range) !== selection.code) return false;
        editor.executeEdits("ai-assistant", [{ range, text: nextCode, forceMoveMarkers: true }]); editor.focus(); return true;
      },
      replaceFile: (nextCode) => {
        const model = editor.getModel(); if (!model) return false;
        const fullRange = model.getFullModelRange(); editor.executeEdits("ai-assistant", [{ range: fullRange, text: nextCode, forceMoveMarkers: true }]); editor.focus(); return true;
      }
    });

    disposablesRef.current.forEach((disposable) => disposable.dispose());
    disposablesRef.current = [];
    disposablesRef.current.push(monaco.editor.onDidChangeMarkers(() => updateDiagnostics()));
    updateDiagnostics();

    disposablesRef.current.push(editor.onDidChangeModelContent(() => {
      if (ignoreSyncRef.current) {
        return;
      }

      const value = editor.getValue();
      setCode(value, undefined, fileIdRef.current);
      emitEditorTyping(true);

      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }

      debounceRef.current = window.setTimeout(() => {
        socketRef.current?.emit("editor:update", {
          roomId,
          userId: session.userId,
          code: value,
          fileId: fileIdRef.current
        });
      }, 70);
    }));

    disposablesRef.current.push(editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel();
      if (!model) return;
      const code = model.getValueInRange(event.selection);
      const startOffset = model.getOffsetAt(event.selection.getStartPosition());
      const endOffset = model.getOffsetAt(event.selection.getEndPosition());
      const signature = fileIdRef.current + ":" + startOffset + ":" + endOffset;
      if (lastSelectionRef.current === signature) return;
      lastSelectionRef.current = signature;
      const selected = Boolean(code.trim());
      setHasSelection(selected);
      onSelectionChange?.(selected ? { fileId: fileIdRef.current, code, startOffset, endOffset } : null);
    }));

    disposablesRef.current.push(editor.onDidChangeCursorPosition((event) => {
      const nextCursor = {
        lineNumber: event.position.lineNumber,
        column: event.position.column
      };
      const signature = `${nextCursor.lineNumber}:${nextCursor.column}`;

      if (lastCursorRef.current === signature) {
        return;
      }

      lastCursorRef.current = signature;
      if (cursorDebounceRef.current) {
        window.clearTimeout(cursorDebounceRef.current);
      }

      cursorDebounceRef.current = window.setTimeout(() => {
        socketRef.current?.emit("editor:cursor", {
          roomId,
          userId: session.userId,
          cursor: nextCursor
        });
      }, 45);
    }));

    disposablesRef.current.push(
      editor.onDidBlurEditorText(() => {
        emitEditorTyping(false);
      })
    );
  };

  useEffect(() => {
    monacoRef.current?.editor.setTheme(editorColorMode === "light" ? "code-sphere-light" : "code-sphere-dark");
  }, [editorColorMode]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();

    if (!editor || !monaco || !model) {
      return;
    }

    monaco.editor.setModelLanguage(model, languageMap[language]);
  }, [language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === code) {
      return;
    }

    ignoreSyncRef.current = true;
    const position = editor.getPosition();
    editor.setValue(code);
    if (position) {
      editor.setPosition(position);
    }
    ignoreSyncRef.current = false;
  }, [code, fileId]);


  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    const openUris = new Set(openFileIds.map((id) => monaco.Uri.parse(`inmemory://workspace/${id}`).toString()));
    monaco.editor.getModels().forEach((model) => {
      if (model.uri.scheme === "inmemory" && model.uri.authority === "workspace" && !openUris.has(model.uri.toString()) && model !== editorRef.current?.getModel()) model.dispose();
    });
  }, [fileId, openFileIds]);

  useEffect(
    () => () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }

      if (cursorDebounceRef.current) {
        window.clearTimeout(cursorDebounceRef.current);
      }

      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];

      if (typingRef.current) {
        socketRef.current?.emit("editor:typing", {
          roomId,
          userId: session.userId,
          isTyping: false
        });
      }
    },
    [roomId, session.userId, socketRef]
  );

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    const typingUserIds = new Set(visibleTypingUsers.map((participant) => participant.userId));

    if (!editor || !monaco || !model) {
      return;
    }

    const nextDecorations = remoteParticipants.flatMap((participant) => {
      const lineNumber = Math.min(Math.max(participant.cursor.lineNumber, 1), model.getLineCount());
      const maxColumn = model.getLineMaxColumn(lineNumber);
      const column = Math.min(Math.max(participant.cursor.column, 1), maxColumn);
      const decorations: MonacoEditor.editor.IModelDeltaDecoration[] = [
        {
          range: new monaco.Range(lineNumber, column, lineNumber, column),
          options: {
            className: `remote-cursor remote-cursor-${participant.accent}`,
            after: {
              content: ` ${participant.username}`,
              inlineClassName: `remote-cursor-label remote-cursor-label-${participant.accent}`
            }
          }
        }
      ];

      if (typingUserIds.has(participant.userId)) {
        decorations.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, maxColumn),
          options: {
            isWholeLine: true,
            className: `remote-line-highlight remote-line-highlight-${participant.accent}`
          }
        });
      }

      return decorations;
    });

    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, nextDecorations);
  }, [code, remoteParticipants, visibleTypingUsers]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model || !monacoRef.current) return;
    onDiagnosticsChange?.(monacoRef.current.editor.getModelMarkers({ resource: model.uri }).slice(0, 50).map((marker) => ({
      fileId,
      message: marker.message.slice(0, 600),
      severity: marker.severity === 8 ? "error" : marker.severity === 4 ? "warning" : marker.severity === 2 ? "info" : "hint",
      startLine: marker.startLineNumber,
      startColumn: marker.startColumn,
      endLine: marker.endLineNumber,
      endColumn: marker.endColumn
    } satisfies AgentDiagnostic)));
  }, [code, fileId, language, onDiagnosticsChange]);

  return (
    <div className="theme-editor-shell relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] shadow-[var(--shadow-soft)]">
      <EditorToolbar
        language={language}
        canEdit={Boolean(canEdit)}
        isPaused={isPaused}
        editorTypingUsers={visibleTypingUsers}
        participants={participants}
        onChangeLanguage={onChangeLanguage}
      />

      <div className="min-h-0 flex-1 overflow-hidden px-1 pb-1 pt-0 sm:px-2 sm:pb-2">
        <Editor
          height="100%"
          path={`inmemory://workspace/${fileId}`}
          language={languageMap[language]}
          value={code}
          onMount={handleMount}
          options={{
            fontFamily: "IBM Plex Mono, monospace",
            fontSize: 14,
            minimap: { enabled: false },
            padding: { top: 18 },
            smoothScrolling: true,
            cursorBlinking: "smooth",
            renderWhitespace: "selection",
            scrollBeyondLastLine: false,
            fixedOverflowWidgets: true,
            bracketPairColorization: {
              enabled: true
            },
            guides: {
              bracketPairs: true,
              indentation: true,
              highlightActiveIndentation: true
            },
            readOnly: !canEdit
          }}
        />
        {hasSelection && onOpenAIAssistant ? <div className="absolute right-4 top-14 z-20 flex overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-bg)] shadow-lg"><button type="button" onClick={() => onOpenAIAssistant("custom")} className="theme-button-primary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold"><Sparkles className="h-3.5 w-3.5" /> Ask AI</button>{(["explain", "fix", "refactor", "optimize", "document", "test"] as AIAction[]).map((action) => <button key={action} type="button" onClick={() => onOpenAIAssistant(action)} className="border-l border-[var(--border)] px-2 py-1.5 text-[10px] font-medium capitalize text-[var(--text-secondary)] hover:bg-[var(--badge-bg)]">{action === "test" ? "Tests" : action}</button>)}</div> : null}
        {isPaused ? (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 shadow-lg backdrop-blur-md sm:inset-x-6 sm:bottom-6 sm:text-sm">
            Editing is paused. Code is read-only until the owner resumes.
          </div>
        ) : null}
      </div>
    </div>
  );
};
