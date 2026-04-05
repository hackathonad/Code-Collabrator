import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef } from "react";
import type * as MonacoEditor from "monaco-editor";
import type { MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import { useRoomStore } from "../../store/useRoomStore";
import type { Participant, UserSession } from "../../types/collaboration";

interface CollaborativeEditorProps {
  code: string;
  language: "javascript" | "python" | "cpp";
  participants: Participant[];
  session: UserSession;
  roomId: string;
  socketRef: MutableRefObject<Socket | null>;
}

const languageMap = {
  javascript: "javascript",
  python: "python",
  cpp: "cpp"
} as const;

export const CollaborativeEditor = ({ code, language, participants, session, roomId, socketRef }: CollaborativeEditorProps) => {
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const ignoreSyncRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const { setCode } = useRoomStore();

  const currentUser = participants.find((participant) => participant.userId === session.userId);
  const canEdit = currentUser?.role !== "viewer";

  const remoteParticipants = useMemo(
    () => participants.filter((participant) => participant.userId !== session.userId && participant.isOnline),
    [participants, session.userId]
  );

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.defineTheme("code-sphere", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#08101c",
        "editorLineNumber.foreground": "#4c5f75",
        "editorLineNumber.activeForeground": "#e2e8f0",
        "editorCursor.foreground": "#7dd3fc",
        "editor.selectionBackground": "#0ea5e933"
      }
    });

    monaco.editor.setTheme("code-sphere");

    editor.onDidChangeModelContent(() => {
      if (ignoreSyncRef.current) {
        return;
      }

      const value = editor.getValue();
      setCode(value);

      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }

      debounceRef.current = window.setTimeout(() => {
        socketRef.current?.emit("editor:update", {
          roomId,
          userId: session.userId,
          code: value
        });
      }, 70);
    });

    editor.onDidChangeCursorSelection((event) => {
      socketRef.current?.emit("editor:cursor", {
        roomId,
        userId: session.userId,
        cursor: {
          lineNumber: event.selection.positionLineNumber,
          column: event.selection.positionColumn
        }
      });
    });
  };

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
  }, [code]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();

    if (!editor || !monaco || !model) {
      return;
    }

    const nextDecorations = remoteParticipants.flatMap((participant) => {
      const lineNumber = Math.min(Math.max(participant.cursor.lineNumber, 1), model.getLineCount());
      const maxColumn = model.getLineMaxColumn(lineNumber);
      const column = Math.min(Math.max(participant.cursor.column, 1), maxColumn);

      return [
        {
          range: new monaco.Range(lineNumber, column, lineNumber, column),
          options: {
            className: `remote-cursor remote-cursor-${participant.accent}`,
            after: {
              content: ` ${participant.username}`,
              inlineClassName: `remote-cursor-label remote-cursor-label-${participant.accent}`
            }
          }
        },
        {
          range: new monaco.Range(lineNumber, 1, lineNumber, maxColumn),
          options: {
            isWholeLine: true,
            className: `remote-line-highlight remote-line-highlight-${participant.accent}`
          }
        }
      ];
    });

    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, nextDecorations);
  }, [remoteParticipants]);

  return (
    <div className="relative h-full overflow-hidden rounded-[28px] border border-white/10 bg-surface-900/90 shadow-panel">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-sky-300/80">Live Editor</p>
          <h3 className="font-display text-xl text-white">Multiplayer code canvas</h3>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${
            canEdit ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"
          }`}
        >
          {canEdit ? "Editing enabled" : "View only"}
        </span>
      </div>

      <Editor
        height="100%"
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
          readOnly: !canEdit
        }}
      />
    </div>
  );
};

