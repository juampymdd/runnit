// Transpiles the editor's TS/JS to executable JS in the browser with
// esbuild-wasm, emitting a sourcemap so the sidecar can map transpiled lines
// back to the original editor lines (esbuild drops TS type-only lines).
import * as esbuildNS from "esbuild-wasm";
import wasmURL from "esbuild-wasm/esbuild.wasm?url";

// Depending on Vite's CJS/ESM interop, the API may sit on the namespace or
// under `.default`. Normalize so `.initialize`/`.transform` always resolve.
const esbuild: typeof import("esbuild-wasm") =
  (esbuildNS as unknown as { default?: typeof import("esbuild-wasm") }).default ?? esbuildNS;

let initPromise: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  if (!initPromise) {
    initPromise = esbuild.initialize({ wasmURL, worker: true });
  }
  return initPromise;
}

export interface TranspileResult {
  code: string;
  map: string;
}

export async function transpile(source: string): Promise<TranspileResult> {
  await ensureReady();
  const result = await esbuild.transform(source, {
    loader: "ts",
    target: "es2020",
    // `cjs` rewrites `import x from "y"` -> `require("y")` (which the sidecar
    // provides) while keeping top-level statements top-level, so per-line
    // capture still works. This is what enables Node builtins + npm packages.
    format: "cjs",
    sourcemap: "external",
    sourcefile: "playground.ts",
    minify: false,
  });
  return { code: result.code, map: result.map };
}
