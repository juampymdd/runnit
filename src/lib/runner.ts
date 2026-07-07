// Thin bridge to the Rust `evaluate` command and the `eval-result` event.
// Degrades gracefully when running in a plain browser (`pnpm dev` without
// Tauri) so the UI can still render for pure frontend work.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface EvalLog {
  level: "log" | "info" | "warn" | "error" | "debug" | "trace";
  line: number;
  text: string;
}

export interface EvalLineResult {
  line: number;
  value: string;
}

export interface EvalError {
  name: string;
  message: string;
  stack: string | null;
}

export interface EvalResult {
  id: number;
  logs: EvalLog[];
  results: EvalLineResult[];
  error: EvalError | null;
}

export interface EvalRequest {
  id: number;
  code: string;
  map: string;
}

export interface EvalProgress {
  type: "progress";
  id: number;
  status: "installing" | "installed" | "error";
  pkg: string;
  message: string;
}

export function isTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

let counter = 0;
export function nextId(): number {
  counter += 1;
  return counter;
}

export async function evaluate(request: EvalRequest): Promise<void> {
  if (!isTauri()) return;
  await invoke("evaluate", { request });
}

export function onEvalResult(cb: (result: EvalResult) => void): Promise<UnlistenFn> {
  return listen<EvalResult>("eval-result", (event) => cb(event.payload));
}

export function onEvalProgress(cb: (progress: EvalProgress) => void): Promise<UnlistenFn> {
  return listen<EvalProgress>("eval-progress", (event) => cb(event.payload));
}
