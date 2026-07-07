import { useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { EvalError, EvalLog, EvalLineResult } from "../lib/runner";

export type RunStatus = "idle" | "running" | "done" | "error";

interface OutputPanelProps {
  status: RunStatus;
  results: EvalLineResult[];
  logs: EvalLog[];
  error: EvalError | null;
  durationMs: number | null;
  installing: string[];
  browserFallback: boolean;
}

type Entry =
  | { kind: "result"; line: number; value: string; key: string }
  | { kind: "log"; line: number; level: EvalLog["level"]; text: string; key: string };

export function OutputPanel({
  status,
  results,
  logs,
  error,
  durationMs,
  installing,
  browserFallback,
}: OutputPanelProps) {
  const reduce = useReducedMotion();

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    logs.forEach((l, i) => out.push({ kind: "log", line: l.line, level: l.level, text: l.text, key: `log-${i}` }));
    results.forEach((r, i) => out.push({ kind: "result", line: r.line, value: r.value, key: `res-${i}` }));
    // Stable sort by line so console output and values read in source order.
    return out.sort((a, b) => a.line - b.line);
  }, [logs, results]);

  const isEmpty = entries.length === 0 && !error && installing.length === 0;

  return (
    <section className="output" aria-label="Output">
      <header className="output-header">
        <div className="output-title">
          <span className="dot" data-status={status} aria-hidden="true" />
          <span>Output</span>
        </div>
        <div className="output-meta">
          {status === "running" && <span className="running-label">running…</span>}
          {status !== "running" && durationMs != null && (
            <span className="duration">{durationMs} ms</span>
          )}
        </div>
      </header>

      <div className="output-body" role="log" aria-live="polite">
        {browserFallback && (
          <div className="notice">
            Running in a browser preview — evaluation happens only inside the
            desktop app. Launch with <code>pnpm tauri dev</code>.
          </div>
        )}

        <AnimatePresence initial={false}>
          {installing.length > 0 && (
            <motion.div
              key="installing"
              className="install-banner"
              role="status"
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="install-spinner" aria-hidden="true" />
              <span className="install-text">
                Installing{" "}
                {installing.map((p, i) => (
                  <span key={p} className="install-pkg">
                    {p}
                    {i < installing.length - 1 ? ", " : ""}
                  </span>
                ))}
                …
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="popLayout" initial={false}>
          {error && (
            <motion.div
              key="error"
              className="error-card"
              role="alert"
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="error-name">{error.name}</span>
              <span className="error-message">{error.message}</span>
            </motion.div>
          )}

          {entries.map((e, i) => (
            <motion.div
              key={e.key}
              layout={!reduce}
              className={e.kind === "log" ? `line log log-${e.level}` : "line result"}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{
                duration: 0.22,
                ease: [0.16, 1, 0.3, 1],
                delay: reduce ? 0 : Math.min(i * 0.012, 0.12),
              }}
            >
              <span className="gutter">{e.line || ""}</span>
              {e.kind === "log" ? (
                <span className="log-text">{e.text}</span>
              ) : (
                <span className="result-text">{e.value}</span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {isEmpty && !browserFallback && (
          <div className="empty-state">
            <div className="empty-glyph" aria-hidden="true">
              {"{ }"}
            </div>
            <p className="empty-title">No output yet</p>
            <p className="empty-sub">
              Start typing on the left. Results appear here and inline as you write.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
