import type * as MonacoEditor from "monaco-editor";

interface EditorAssistantItem {
  label: string;
  insertText: string;
  detail: string;
  documentation: string;
  kind?: MonacoEditor.languages.CompletionItemKind;
  insertTextRules?: MonacoEditor.languages.CompletionItemInsertTextRule;
  keywords?: string[];
}

const createRange = (model: MonacoEditor.editor.ITextModel, lineNumber: number, column: number) => {
  const word = model.getWordUntilPosition({ lineNumber, column });

  return {
    startLineNumber: lineNumber,
    endLineNumber: lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn
  };
};

const registerCompletionProvider = (
  monaco: typeof MonacoEditor,
  language: string,
  suggestions: EditorAssistantItem[]
) =>
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: [".", "(", "_"],
    provideCompletionItems(model, position) {
      const range = createRange(model, position.lineNumber, position.column);

      return {
        suggestions: suggestions.map((item) => ({
          ...item,
          kind: item.kind ?? monaco.languages.CompletionItemKind.Snippet,
          range
        }))
      };
    }
  });

const registerHoverProvider = (monaco: typeof MonacoEditor, language: string, items: EditorAssistantItem[]) =>
  monaco.languages.registerHoverProvider(language, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) {
        return null;
      }

      const match = items.find((item) => {
        const aliases = [item.label, ...(item.keywords ?? [])];
        return aliases.some((alias) => alias.toLowerCase() === word.word.toLowerCase());
      });

      if (!match) {
        return null;
      }

      return {
        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        contents: [
          { value: `**${match.label}**` },
          { value: match.detail },
          { value: match.documentation }
        ]
      };
    }
  });

let configured = false;

export const configureMonaco = (monaco: typeof MonacoEditor) => {
  if (configured) {
    return;
  }

  configured = true;

  monaco.editor.defineTheme("code-sphere-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "keyword", foreground: "7dd3fc", fontStyle: "bold" },
      { token: "number", foreground: "f59e0b" },
      { token: "string", foreground: "86efac" },
      { token: "type.identifier", foreground: "c4b5fd" },
      { token: "delimiter", foreground: "cbd5e1" }
    ],
    colors: {
      "editor.background": "#08101c",
      "editorLineNumber.foreground": "#4c5f75",
      "editorLineNumber.activeForeground": "#e2e8f0",
      "editorCursor.foreground": "#7dd3fc",
      "editor.selectionBackground": "#0ea5e933",
      "editor.lineHighlightBackground": "#122033",
      "editorBracketMatch.background": "#1d4ed833",
      "editorBracketMatch.border": "#38bdf8"
    }
  });

  monaco.editor.defineTheme("code-sphere-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "keyword", foreground: "0369a1", fontStyle: "bold" },
      { token: "number", foreground: "b45309" },
      { token: "string", foreground: "047857" },
      { token: "type.identifier", foreground: "7c3aed" },
      { token: "delimiter", foreground: "334155" }
    ],
    colors: {
      "editor.background": "#f8fafc",
      "editorLineNumber.foreground": "#94a3b8",
      "editorLineNumber.activeForeground": "#0f172a",
      "editorCursor.foreground": "#0284c7",
      "editor.selectionBackground": "#0ea5e926",
      "editor.lineHighlightBackground": "#e2e8f080",
      "editorBracketMatch.background": "#bae6fd66",
      "editorBracketMatch.border": "#0ea5e9"
    }
  });

  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    target: monaco.languages.typescript.ScriptTarget.ES2020
  });

  const javascriptItems: EditorAssistantItem[] = [
    {
      label: "clg",
      insertText: "console.log(${1:value});",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Log value",
      documentation: "Insert a `console.log()` statement for quick debugging.",
      keywords: ["console", "log"]
    },
    {
      label: "fn",
      insertText: "function ${1:name}(${2:args}) {\n\t${3:// code}\n}",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Function snippet",
      documentation: "Insert a reusable JavaScript function declaration.",
      keywords: ["function"]
    },
    {
      label: "fetch",
      insertText: "const response = await fetch(${1:url});\nconst data = await response.json();",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Fetch snippet",
      documentation: "Insert a basic `fetch()` request with JSON parsing."
    },
    {
      label: "asyncfn",
      insertText: "async function ${1:name}(${2:args}) {\n\t${3:// code}\n}",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Async function",
      documentation: "Insert an async function for awaited operations.",
      keywords: ["async"]
    },
    {
      label: "forof",
      insertText: "for (const ${1:item} of ${2:items}) {\n\t${3:// code}\n}",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "For...of loop",
      documentation: "Iterate over iterable values with a clean `for...of` loop.",
      keywords: ["for"]
    }
  ];

  registerCompletionProvider(monaco, "javascript", javascriptItems);
  registerHoverProvider(monaco, "javascript", javascriptItems);

  const pythonItems: EditorAssistantItem[] = [
    {
      label: "def",
      insertText: "def ${1:name}(${2:args}):\n    ${3:pass}",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Function snippet",
      documentation: "Insert a Python function definition.",
      keywords: ["function"]
    },
    {
      label: "ifmain",
      insertText: "if __name__ == \"__main__\":\n    ${1:main()}",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Main guard",
      documentation: "Insert the Python entry-point guard.",
      keywords: ["main"]
    },
    {
      label: "print",
      insertText: "print(${1:value})",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Print value",
      documentation: "Insert a `print()` statement."
    },
    {
      label: "forin",
      insertText: "for ${1:item} in ${2:items}:\n    ${3:pass}",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "For loop",
      documentation: "Insert a Python `for ... in ...` loop.",
      keywords: ["for"]
    },
    {
      label: "class",
      insertText: "class ${1:Name}:\n    def __init__(self, ${2:args}):\n        ${3:pass}",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Class snippet",
      documentation: "Insert a Python class with an initializer."
    }
  ];

  registerCompletionProvider(monaco, "python", pythonItems);
  registerHoverProvider(monaco, "python", pythonItems);

  const cppItems: EditorAssistantItem[] = [
    {
      label: "main",
      insertText: "#include <iostream>\nusing namespace std;\n\nint main() {\n\t${1:// code}\n\treturn 0;\n}",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Main snippet",
      documentation: "Insert a complete C++ `main()` template.",
      keywords: ["int", "main"]
    },
    {
      label: "cout",
      insertText: "cout << ${1:value} << endl;",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Output snippet",
      documentation: "Insert a `cout` statement with `endl`."
    },
    {
      label: "fori",
      insertText: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3:// code}\n}",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "For loop snippet",
      documentation: "Insert an indexed C++ `for` loop.",
      keywords: ["for"]
    },
    {
      label: "vector",
      insertText: "vector<${1:int}> ${2:values};",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Vector declaration",
      documentation: "Insert a typed `std::vector` declaration.",
      keywords: ["std", "vector"]
    },
    {
      label: "sort",
      insertText: "sort(${1:values}.begin(), ${1:values}.end());",
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "Sort vector",
      documentation: "Insert a standard-library sort call.",
      keywords: ["algorithm", "sort"]
    }
  ];

  registerCompletionProvider(monaco, "cpp", cppItems);
  registerHoverProvider(monaco, "cpp", cppItems);
};
