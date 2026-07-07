import { useCallback, useEffect, useRef } from "react";

interface SplitterProps {
  /** Left pane width as a percentage (0–100). */
  ratio: number;
  onChange: (ratio: number) => void;
  min?: number;
  max?: number;
}

/**
 * Draggable vertical divider. Reports the new left-pane ratio as the pointer
 * moves. Uses pointer capture so the drag survives fast movement, and exposes
 * proper ARIA separator semantics + keyboard resize.
 */
export function Splitter({ ratio, onChange, min = 25, max = 75 }: SplitterProps) {
  const dragging = useRef(false);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    onChange(clamp(pct));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") onChange(clamp(ratio - 2));
    else if (e.key === "ArrowRight") onChange(clamp(ratio + 2));
    else if (e.key === "Home") onChange(min);
    else if (e.key === "End") onChange(max);
    else return;
    e.preventDefault();
  };

  // Safety: clear drag flag if the pointer is released outside the element.
  useEffect(() => {
    const clear = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointerup", clear);
    return () => window.removeEventListener("pointerup", clear);
  }, []);

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(ratio)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label="Resize editor and output panels"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onKeyDown={onKeyDown}
    >
      <span className="splitter-handle" aria-hidden="true" />
    </div>
  );
}
