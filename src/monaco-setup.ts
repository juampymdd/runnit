// Configure Monaco to run fully offline (no CDN) inside the Tauri webview.
// We bundle the editor + its language workers locally via Vite's ?worker imports
// and hand the instance to @monaco-editor/react's loader.
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { loader } from "@monaco-editor/react";

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

// Treat the editor buffer as a standalone playground module: allow top-level
// await / return-ish code, and don't nag about missing imports.
monaco.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ES2020,
  allowNonTsExtensions: true,
  moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
  module: monaco.typescript.ModuleKind.ESNext,
  noEmit: true,
  esModuleInterop: true,
  allowJs: true,
});
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  diagnosticCodesToIgnore: [
    1108, // return outside function
    1375, // top-level await
    1378, // top-level await (module)
    2307, // cannot find module 'X' — modules resolve at runtime (builtins + auto-install)
    2792, // cannot find module; did you mean to set moduleResolution?
    7016, // could not find a declaration file for module 'X'
  ],
});

// Load @types/node into the TS worker so Node builtins (crypto, fs, path, …)
// resolve and autocomplete. Each .d.ts is registered as an extra lib under its
// node_modules path so the triple-slash references between them line up.
const nodeTypeFiles = import.meta.glob("/node_modules/@types/node/**/*.d.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

for (const [absPath, content] of Object.entries(nodeTypeFiles)) {
  // absPath looks like "/node_modules/@types/node/crypto.d.ts"
  // addExtraLib(content, filePath) — content first.
  monaco.typescript.typescriptDefaults.addExtraLib(content, "file://" + absPath);
}

// A dark theme tuned to the app's surface color so the editor and chrome share
// one continuous background.
monaco.editor.defineTheme("runnit-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0d1014",
    "editor.foreground": "#e6e8eb",
    "editorLineNumber.foreground": "#3a414b",
    "editorLineNumber.activeForeground": "#8b93a1",
    "editor.selectionBackground": "#2a3441",
    "editor.lineHighlightBackground": "#151a20",
    "editorCursor.foreground": "#f5a623",
    "editorIndentGuide.background1": "#1b2129",
    "editorWhitespace.foreground": "#20262e",
  },
});

monaco.editor.defineTheme("runnit-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#1b1f24",
    "editorLineNumber.foreground": "#c4cad2",
    "editorLineNumber.activeForeground": "#6b7280",
    "editor.lineHighlightBackground": "#f6f7f9",
    "editorCursor.foreground": "#c07a10",
  },
});

loader.config({ monaco });

export { monaco };
