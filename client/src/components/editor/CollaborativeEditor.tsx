import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef } from "react";
import type * as MonacoEditor from "monaco-editor";
import type { MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import { useTheme } from "../../context/ThemeContext";
import { useRoomStore } from "../../store/useRoomStore";
import type { Participant, TypingParticipant, UserSession } from "../../types/collaboration";
import { EditorToolbar } from "./EditorToolbar";
import { configureMonaco } from "./monacoSetup";

interface CollaborativeEditorProps {
  code: string;
  language: "javascript" | "python" | "cpp";
  participants: Participant[];
  editorTypingUsers: TypingParticipant[];
  session: UserSession;
  roomId: string;
  socketRef: MutableRefObject<Socket | null>;
  onChangeLanguage: (language: "javascript" | "python" | "cpp") => void;
  isPaused: boolean;
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
  socketRef,
  onChangeLanguage,
  isPaused
}: CollaborativeEditorProps) => {
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const ignoreSyncRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const cursorDebounceRef = useRef<number | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const lastCursorRef = useRef("1:1");
  const typingRef = useRef(false);
  const { setCode } = useRoomStore();
  const { editorColorMode } = useTheme();

  const currentUser = participants.find((participant) => participant.userId === session.userId);
  const canEdit = currentUser?.role !== "viewer" && !isPaused;

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

    editor.onDidChangeModelContent(() => {
      if (ignoreSyncRef.current) {
        return;
      }

      const value = editor.getValue();
      setCode(value);
      emitEditorTyping(true);

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

    editor.onDidChangeCursorPosition((event) => {
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
    });

    editor.onDidBlurEditorText(() => {
      emitEditorTyping(false);
    });
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
  }, [code]);

  useEffect(
    () => () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }

      if (cursorDebounceRef.current) {
        window.clearTimeout(cursorDebounceRef.current);
      }

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

  return (
    <div className="theme-editor-shell relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] shadow-[var(--shadow-soft)]">
      <EditorToolbar
        language={language}
        canEdit={Boolean(canEdit)}
        isPaused={isPaused}
        editorTypingUsers={visibleTypingUsers}
        onChangeLanguage={onChangeLanguage}
      />

      <div className="min-h-0 flex-1 overflow-hidden px-1 pb-1 pt-0 sm:px-2 sm:pb-2">
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
        {isPaused ? (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 shadow-lg backdrop-blur-md sm:inset-x-6 sm:bottom-6 sm:text-sm">
            Editing is paused. Code is read-only until the owner resumes.
          </div>
        ) : null}
      </div>
    </div>
  );
};
