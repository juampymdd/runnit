import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { CodeEditor } from "./components/Editor";
import { OutputPanel, type RunStatus } from "./components/OutputPanel";
import { Splitter } from "./components/Splitter";
import { Toolbar } from "./components/Toolbar";
import { TabsBar, type Doc } from "./components/TabsBar";
import { useDebounce } from "./hooks/useDebounce";
import { transpile } from "./lib/transpile";
import {
  evaluate,
  isTauri,
  nextId,
  onEvalResult,
  onEvalProgress,
  type EvalError,
  type EvalLog,
  type EvalLineResult,
} from "./lib/runner";
import { applyTheme, getInitialTheme, type Theme } from "./lib/theme";
import { basename, openFile, saveAs, saveTo } from "./lib/files";

const SAMPLE = `// Welcome to runnit — a live JS/TS playground.
// Edit anything; results appear inline and on the right.

const greet = (name: string) => \`Hello, \${name}!\`;
greet("world");

const nums = [1, 2, 3, 4, 5];
const doubled = nums.map((n) => n * 2);
const total = doubled.reduce((a, b) => a + b, 0);

console.log("doubled:", doubled);
total;
`;

const DOCS_KEY = "runnit.docs";
const ACTIVE_KEY = "runnit.activeDoc";
const RATIO_KEY = "runnit.ratio";
const LEGACY_CODE_KEY = "runnit.code";

interface DocResult {
  results: EvalLineResult[];
  logs: EvalLog[];
  error: EvalError | null;
  status: RunStatus;
  durationMs: number | null;
  installing: string[];
}

const EMPTY_RESULT: DocResult = {
  results: [],
  logs: [],
  error: null,
  status: "idle",
  durationMs: null,
  installing: [],
};

function loadDocs(): Doc[] {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Doc[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* fall through */
  }
  // Migrate a legacy single-buffer session, or seed the sample.
  const legacy = localStorage.getItem(LEGACY_CODE_KEY);
  return [{ id: "doc-1", name: "playground", code: legacy ?? SAMPLE }];
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [docs, setDocs] = useState<Doc[]>(loadDocs);
  const [activeId, setActiveId] = useState<string>(
    () => localStorage.getItem(ACTIVE_KEY) ?? "doc-1"
  );
  const [ratio, setRatio] = useState<number>(() => {
    const stored = Number(localStorage.getItem(RATIO_KEY));
    return stored >= 25 && stored <= 75 ? stored : 55;
  });

  // Per-tab evaluation results, so switching tabs is instant and correct.
  const [resultsByTab, setResultsByTab] = useState<Record<string, DocResult>>({});

  const nextDocNum = useRef(
    Math.max(1, ...docs.map((d) => Number(d.id.replace("doc-", "")) || 0)) + 1
  );
  const idToTab = useRef<Map<number, string>>(new Map());
  const latestIdByTab = useRef<Map<string, number>>(new Map());
  const startedAt = useRef<Map<number, number>>(new Map());
  const lastToast = useRef<string>("");
  // Last code written to disk per doc, to compute the unsaved indicator.
  const savedCode = useRef<Map<string, string>>(new Map());

  const browserFallback = !isTauri();

  const activeDoc = useMemo(
    () => docs.find((d) => d.id === activeId) ?? docs[0],
    [docs, activeId]
  );
  const activeResult = resultsByTab[activeDoc?.id ?? ""] ?? EMPTY_RESULT;
  const debouncedCode = useDebounce(activeDoc?.code ?? "", 300);

  // Persist.
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => localStorage.setItem(DOCS_KEY, JSON.stringify(docs)), [docs]);
  useEffect(() => localStorage.setItem(ACTIVE_KEY, activeId), [activeId]);
  useEffect(() => localStorage.setItem(RATIO_KEY, String(ratio)), [ratio]);

  const patchResult = useCallback((tabId: string, patch: Partial<DocResult>) => {
    setResultsByTab((prev) => ({
      ...prev,
      [tabId]: { ...(prev[tabId] ?? EMPTY_RESULT), ...patch },
    }));
  }, []);

  // Subscribe to sidecar results once; route each result to its origin tab.
  useEffect(() => {
    const unlistenPromise = onEvalResult((res) => {
      const tabId = idToTab.current.get(res.id);
      if (!tabId) return;
      idToTab.current.delete(res.id);
      // Ignore if a newer run for that tab has since started.
      if (latestIdByTab.current.get(tabId) !== res.id) return;
      const started = startedAt.current.get(res.id) ?? performance.now();
      startedAt.current.delete(res.id);
      patchResult(tabId, {
        results: res.results,
        logs: res.logs,
        error: res.error,
        status: res.error ? "error" : "done",
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        installing: [],
      });
    });
    return () => {
      unlistenPromise.then((un) => un());
    };
  }, [patchResult]);

  // Subscribe to install-progress events; track per-tab installing packages.
  useEffect(() => {
    const unlistenPromise = onEvalProgress((p) => {
      const tabId = idToTab.current.get(p.id);
      if (!tabId) return;
      if (latestIdByTab.current.get(tabId) !== p.id) return;
      setResultsByTab((prev) => {
        const cur = prev[tabId] ?? EMPTY_RESULT;
        const installing =
          p.status === "installing"
            ? cur.installing.includes(p.pkg)
              ? cur.installing
              : [...cur.installing, p.pkg]
            : cur.installing.filter((x) => x !== p.pkg);
        return {
          ...prev,
          [tabId]: { ...cur, installing, status: p.status === "installing" ? "running" : cur.status },
        };
      });
      if (p.status === "error") toast.error("Install failed", { description: p.message });
    });
    return () => {
      unlistenPromise.then((un) => un());
    };
  }, []);

  // Transpile + evaluate the active tab whenever its (debounced) code changes.
  useEffect(() => {
    const tabId = activeDoc?.id;
    if (!tabId) return;
    let cancelled = false;

    if (!debouncedCode.trim()) {
      patchResult(tabId, { ...EMPTY_RESULT });
      return;
    }

    (async () => {
      const id = nextId();
      latestIdByTab.current.set(tabId, id);
      idToTab.current.set(id, tabId);
      startedAt.current.set(id, performance.now());
      patchResult(tabId, { status: "running" });

      try {
        const { code: js, map } = await transpile(debouncedCode);
        if (cancelled || latestIdByTab.current.get(tabId) !== id) return;
        await evaluate({ id, code: js, map });
      } catch (e) {
        if (cancelled || latestIdByTab.current.get(tabId) !== id) return;
        idToTab.current.delete(id);
        patchResult(tabId, {
          results: [],
          logs: [],
          error: {
            name: "SyntaxError",
            message: e instanceof Error ? e.message : String(e),
            stack: null,
          },
          status: "error",
          durationMs: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedCode, activeDoc?.id, patchResult]);

  // Error toast for the active tab (deduped). Skip SyntaxErrors: those fire on
  // every keystroke while the code is mid-typing — they show in the panel, no
  // need to pop a toast each time.
  useEffect(() => {
    const err = activeResult.error;
    if (err && err.name !== "SyntaxError" && err.message !== lastToast.current) {
      lastToast.current = err.message;
      toast.error(err.name, { description: err.message });
    }
    if (!err) lastToast.current = "";
  }, [activeResult.error]);

  // ---- Tab operations ----
  const updateActiveCode = useCallback(
    (code: string) => {
      setDocs((prev) => prev.map((d) => (d.id === activeId ? { ...d, code } : d)));
    },
    [activeId]
  );

  const addDoc = useCallback(() => {
    const n = nextDocNum.current++;
    const id = `doc-${n}`;
    setDocs((prev) => [...prev, { id, name: `untitled-${n}`, code: "" }]);
    setActiveId(id);
  }, []);

  const closeDoc = useCallback(
    (id: string) => {
      setDocs((prev) => {
        if (prev.length <= 1) return prev;
        const idx = prev.findIndex((d) => d.id === id);
        const next = prev.filter((d) => d.id !== id);
        if (id === activeId) {
          const fallback = next[Math.max(0, idx - 1)];
          setActiveId(fallback.id);
        }
        return next;
      });
      setResultsByTab((prev) => {
        const rest = { ...prev };
        delete rest[id];
        return rest;
      });
    },
    [activeId]
  );

  const renameDoc = useCallback((id: string, name: string) => {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
  }, []);

  // ---- File save / open ----
  const saveActive = useCallback(
    async (forceDialog = false) => {
      const doc = docs.find((d) => d.id === activeId);
      if (!doc) return;
      try {
        if (doc.path && !forceDialog) {
          await saveTo(doc.path, doc.code);
          savedCode.current.set(doc.id, doc.code);
          setDocs((prev) => [...prev]); // refresh dirty state
          toast.success("Saved", { description: basename(doc.path) });
          return;
        }
        const suggested = doc.path ? basename(doc.path) : `${doc.name}.ts`;
        const path = await saveAs(doc.code, suggested);
        if (!path) return;
        savedCode.current.set(doc.id, doc.code);
        setDocs((prev) =>
          prev.map((d) => (d.id === doc.id ? { ...d, path, name: basename(path) } : d))
        );
        toast.success("Saved", { description: basename(path) });
      } catch (e) {
        toast.error("Save failed", { description: e instanceof Error ? e.message : String(e) });
      }
    },
    [docs, activeId]
  );

  const openDoc = useCallback(async () => {
    try {
      const opened = await openFile();
      if (!opened) return;
      const n = nextDocNum.current++;
      const id = `doc-${n}`;
      savedCode.current.set(id, opened.contents);
      setDocs((prev) => [
        ...prev,
        { id, name: basename(opened.path), code: opened.contents, path: opened.path },
      ]);
      setActiveId(id);
    } catch (e) {
      toast.error("Open failed", { description: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Docs with unsaved changes relative to their file (only tracked once saved/opened).
  const dirtyIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of docs) {
      if (d.path && savedCode.current.get(d.id) !== d.code) s.add(d.id);
    }
    return s;
  }, [docs]);

  // Keyboard: new tab, close tab, switch by number.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActive(e.shiftKey); // Shift = Save As
      } else if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        openDoc();
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        addDoc();
      } else if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        closeDoc(activeId);
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (docs[idx]) {
          e.preventDefault();
          setActiveId(docs[idx].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addDoc, closeDoc, activeId, docs, saveActive, openDoc]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    []
  );
  const clearCode = useCallback(() => updateActiveCode(""), [updateActiveCode]);

  return (
    <div className="app">
      <Toolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        onClear={clearCode}
        onSave={() => saveActive(false)}
        onOpen={openDoc}
      />
      <TabsBar
        docs={docs}
        activeId={activeId}
        dirtyIds={dirtyIds}
        onSelect={setActiveId}
        onClose={closeDoc}
        onAdd={addDoc}
        onRename={renameDoc}
      />

      <main className="panes">
        <div className="pane editor-pane" style={{ width: `${ratio}%` }}>
          <CodeEditor
            docId={activeDoc?.id ?? "doc-1"}
            value={activeDoc?.code ?? ""}
            onChange={updateActiveCode}
            theme={theme}
            results={activeResult.results}
          />
        </div>

        <Splitter ratio={ratio} onChange={setRatio} />

        <div className="pane output-pane" style={{ width: `${100 - ratio}%` }}>
          <OutputPanel
            status={activeResult.status}
            results={activeResult.results}
            logs={activeResult.logs}
            error={activeResult.error}
            durationMs={activeResult.durationMs}
            installing={activeResult.installing}
            browserFallback={browserFallback}
          />
        </div>
      </main>

      <Toaster
        theme={theme}
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ style: { fontFamily: "inherit" } }}
      />
    </div>
  );
}
