export type Theme = "dark" | "light";

const KEY = "runnit.theme";

export function getInitialTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark"; // dark by default — the editor standard.
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(KEY, theme);
}
