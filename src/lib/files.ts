// File save/open via Tauri's native dialog + small Rust fs commands.
// No-ops gracefully in a plain browser (no Tauri).
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./runner";

const FILTERS = [
  { name: "JS / TS", extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"] },
  { name: "All files", extensions: ["*"] },
];

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Prompt for a location and write. Returns the chosen path, or null if cancelled. */
export async function saveAs(contents: string, suggestedName: string): Promise<string | null> {
  if (!isTauri()) return null;
  const path = await save({ defaultPath: suggestedName, filters: FILTERS });
  if (!path) return null;
  await invoke("write_file", { path, contents });
  return path;
}

/** Write to a known path (no dialog). */
export async function saveTo(path: string, contents: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("write_file", { path, contents });
}

/** Prompt to open a file. Returns { path, contents } or null if cancelled. */
export async function openFile(): Promise<{ path: string; contents: string } | null> {
  if (!isTauri()) return null;
  const path = await open({ multiple: false, directory: false, filters: FILTERS });
  if (!path || typeof path !== "string") return null;
  const contents = await invoke<string>("read_file", { path });
  return { path, contents };
}
