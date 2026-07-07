import { useEffect, useRef } from "react";
import MonacoEditor, { type OnMount, type Monaco } from "@monaco-editor/react";
import type { editor as MonacoNS } from "monaco-editor";
import type { EvalLineResult } from "../lib/runner";
import type { Theme } from "../lib/theme";

interface EditorProps {
  docId: string;
  value: string;
  onChange: (value: string) => void;
  theme: Theme;
  results: EvalLineResult[];
}

function inlineText(value: string): string {
  const flat = value.replace(/\s*\n\s*/g, " ").trim();
  return flat.length > 140 ? flat.slice(0, 139) + "…" : flat;
}

export function CodeEditor({ docId, value, onChange, theme, results }: EditorProps) {
  const editorRef = useRef<MonacoNS.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const collectionRef = useRef<MonacoNS.IEditorDecorationsCollection | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    collectionRef.current = editor.createDecorationsCollection();
    editor.focus();
  };

  // Paint per-line results as injected text at the end of each line.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const collection = collectionRef.current;
    if (!editor || !monaco || !collection) return;

    const model = editor.getModel();
    if (!model) return;

    const lineCount = model.getLineCount();
    // Keep only the last result per line, within bounds.
    const byLine = new Map<number, string>();
    for (const r of results) {
      if (r.line >= 1 && r.line <= lineCount) byLine.set(r.line, r.value);
    }

    const decorations: MonacoNS.IModelDeltaDecoration[] = [];
    for (const [line, val] of byLine) {
      const col = model.getLineMaxColumn(line);
      decorations.push({
        range: new monaco.Range(line, col, line, col),
        options: {
          after: {
            content: "  " + inlineText(val),
            inlineClassName: "inline-result",
          },
          showIfCollapsed: true,
        },
      });
    }
    collection.set(decorations);
  }, [results, docId]);

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="typescript"
      path={`${docId}.ts`}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={handleMount}
      theme={theme === "dark" ? "runnit-dark" : "runnit-light"}
      loading={<div className="editor-loading">Loading editor…</div>}
      options={{
        fontFamily:
          '"JetBrains Mono", "SF Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace',
        fontSize: 14,
        lineHeight: 22,
        fontLigatures: true,
        minimap: { enabled: false },
        // Kill noisy word-based ("abc") suggestions pulled from buffer text;
        // keep real TS/JS language-service completions.
        wordBasedSuggestions: "off",
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        cursorBlinking: "smooth",
        renderLineHighlight: "line",
        padding: { top: 18, bottom: 18 },
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: false,
        overviewRulerLanes: 0,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "off",
      }}
    />
  );
}
