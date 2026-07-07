import { motion } from "motion/react";
import { Logo } from "./Logo";
import type { Theme } from "../lib/theme";

interface ToolbarProps {
  theme: Theme;
  onToggleTheme: () => void;
  onClear: () => void;
  onSave: () => void;
  onOpen: () => void;
}

export function Toolbar({ theme, onToggleTheme, onClear, onSave, onOpen }: ToolbarProps) {
  return (
    <header className="toolbar" role="banner">
      <div className="brand">
        <Logo size={24} />
        <span className="brand-name">runnit</span>
        <span className="brand-tag">live JS/TS playground</span>
      </div>

      <div className="toolbar-actions">
        <button className="btn" onClick={onOpen} title="Open file (Ctrl/⌘+O)">
          Open
        </button>
        <button className="btn" onClick={onSave} title="Save (Ctrl/⌘+S · Shift for Save As)">
          Save
        </button>
        <button className="btn" onClick={onClear} title="Reset editor">
          Clear
        </button>
        <button
          className="btn icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          <motion.span
            key={theme}
            initial={{ rotate: -30, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {theme === "dark" ? "☾" : "☀"}
          </motion.span>
        </button>
      </div>
    </header>
  );
}
