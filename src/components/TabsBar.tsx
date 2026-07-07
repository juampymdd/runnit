import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export interface Doc {
  id: string;
  name: string;
  code: string;
  path?: string; // filesystem path once saved/opened
}

interface TabsBarProps {
  docs: Doc[];
  activeId: string;
  dirtyIds: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
}

export function TabsBar({ docs, activeId, dirtyIds, onSelect, onClose, onAdd, onRename }: TabsBarProps) {
  const reduce = useReducedMotion();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (doc: Doc) => {
    setEditingId(doc.id);
    setDraft(doc.name);
  };

  const commitRename = () => {
    if (editingId) {
      const name = draft.trim();
      if (name) onRename(editingId, name);
    }
    setEditingId(null);
  };

  return (
    <div className="tabsbar" role="tablist" aria-label="Open documents">
      <div className="tabs-scroll">
        <AnimatePresence initial={false} mode="popLayout">
          {docs.map((doc) => {
            const active = doc.id === activeId;
            return (
              <motion.div
                key={doc.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: -6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className={active ? "tab active" : "tab"}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onMouseDown={(e) => {
                  // Middle-click closes.
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(doc.id);
                  }
                }}
                onClick={() => onSelect(doc.id)}
                onDoubleClick={() => startRename(doc)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(doc.id);
                  } else if (e.key === "F2") {
                    startRename(doc);
                  }
                }}
                title={doc.name}
              >
                {active && (
                  <motion.span
                    layoutId={reduce ? undefined : "tab-underline"}
                    className="tab-underline"
                    aria-hidden="true"
                  />
                )}
                {editingId === doc.id ? (
                  <input
                    ref={inputRef}
                    className="tab-rename"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      else if (e.key === "Escape") setEditingId(null);
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <span className="tab-name">{doc.name}</span>
                )}

                {editingId !== doc.id && (
                  <span className="tab-trailing">
                    {dirtyIds.has(doc.id) && <span className="tab-dirty" aria-label="unsaved" />}
                    {docs.length > 1 && (
                      <button
                        className="tab-close"
                        aria-label={`Close ${doc.name}`}
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onClose(doc.id);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <button className="tab-add" onClick={onAdd} aria-label="New document" title="New document (Ctrl/⌘+T)">
        +
      </button>
    </div>
  );
}
