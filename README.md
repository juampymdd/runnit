# runnit

A live JavaScript/TypeScript playground desktop app in the spirit of **RunJS** —
you type on the left, it runs as you type, and results appear inline and on the
right. Built with **Tauri 2**, **React + Vite**, **Monaco**, **esbuild-wasm**,
and a **persistent Node.js sidecar** evaluator.

```
┌───────────────────────────┬───────────────────────────┐
│  Monaco editor (TS/JS)    │  Output                   │
│                           │                           │
│  const x = 5      → 5     │  1  doubled: [ 2, 4, 6 ]  │
│  x * 2            → 10    │  …  10                    │
└───────────────────────────┴───────────────────────────┘
```

---

## How it works (architecture)

The live pipeline, per keystroke burst:

1. You type in **Monaco** (left pane).
2. Changes are **debounced ~300 ms** so we don't run on every keystroke.
3. The buffer is **transpiled TS→JS in the browser** with `esbuild-wasm`,
   emitting a **sourcemap**.
4. The transpiled code + sourcemap are sent to Rust via a Tauri **`invoke`**.
5. Rust **forwards them to the persistent Node sidecar** over stdin
   (one JSON object per line: `{ id, code, map }`).
6. The sidecar **instruments the AST** (`@babel/parser` + `@babel/types` +
   `@babel/generator`): each top-level expression / declaration is wrapped in
   `__capture(line, value)` and each statement is prefixed with
   `__setLine(line)`. It then runs the code in a fresh **`node:vm`** context
   inside a **worker thread**, with `console.*` intercepted.
7. The sidecar writes the result as a JSON line to stdout
   (`{ id, logs, results, error }`).
8. Rust **emits a Tauri `eval-result` event**; the frontend paints the values
   inline in the editor and streams logs/values into the output panel.

### Key design decisions

- **Persistent sidecar, driven from Rust.** The Node process is spawned once at
  startup (`app.shell().sidecar("app")`) and its lifecycle is owned by Rust, so
  it's killed on app exit (`RunEvent::ExitRequested`/`Exit`) — **no orphan
  processes**. Communication is a trivial newline-delimited JSON protocol.

- **Per-line results via an AST transform in the sidecar** (as required). The
  transform only touches **top-level** statements, matching RunJS behavior:
  expression statements and variable declarations get their value captured;
  function/class declarations and control-flow show nothing.

- **Correct line numbers despite TS stripping.** esbuild removes type-only
  lines, so a transpiled line ≠ your editor line. We emit an esbuild sourcemap
  and, inside the sidecar, use `source-map`'s `SourceMapConsumer` to map each
  captured node back to its **original editor line** — so inline results land on
  the right row.

- **Infinite-loop protection with two layers.** Each evaluation runs in a Node
  **worker thread** with a **3 s** budget. The `vm` `timeout` option interrupts
  synchronous runaway loops (`while(true){}`) with a clean error; a
  `worker.terminate()` backstop kills anything the vm timeout can't reach. The
  app never hangs.

- **Fresh context per run.** Every evaluation gets a new `vm` context, so state
  never leaks between runs.

- **Offline Monaco.** Monaco and its language workers are bundled locally (no
  CDN) so the packaged desktop app works with no network.

### Motion & design

- Dark theme by default (editor standard) with a full light sibling; tokens in
  `src/styles.css`.
- Two resizable panes with a draggable, keyboard-accessible splitter
  (`role="separator"`, arrow keys / Home / End).
- Animations use **Motion** (`motion/react`) with spring/ease-out easing and
  short 150–220 ms durations; results fade/slide in with a subtle stagger.
  **Sonner** provides error toasts. Everything respects
  `prefers-reduced-motion`.
- Accessibility: visible keyboard focus, ARIA roles/labels, `aria-live` output
  log, AA contrast in both themes.

---

## Project layout

```
runnit.js/
├─ index.html                 Vite entry
├─ package.json               Frontend + Tauri scripts
├─ vite.config.ts
├─ tsconfig.json
├─ src/                       React frontend
│  ├─ main.tsx
│  ├─ App.tsx                 debounce → transpile → evaluate → render
│  ├─ monaco-setup.ts         offline Monaco + themes
│  ├─ styles.css              design tokens & layout
│  ├─ components/             Editor, OutputPanel, Splitter, Toolbar
│  ├─ hooks/useDebounce.ts
│  └─ lib/                    transpile.ts, runner.ts, theme.ts
├─ sidecar/                   Node evaluator (its own package)
│  ├─ index.js                stdin loop + AST instrumentation + line mapping
│  ├─ worker-src.js           vm runner (loaded as a string; runs in a worker)
│  ├─ build.js                pkg build + target-triple rename
│  └─ package.json
└─ src-tauri/                 Rust backend
   ├─ Cargo.toml
   ├─ tauri.conf.json         externalBin: ["binaries/app"]
   ├─ capabilities/default.json   shell:allow-execute for the sidecar
   ├─ generate-icon.cjs       makes icons/icon.png (no deps)
   ├─ binaries/               built sidecar binary lands here
   └─ src/{main.rs,lib.rs}    sidecar lifecycle + evaluate command
```

---

## Prerequisites

- **Node.js 18+** (built/tested with Node 22) and **pnpm 10+**
  (`corepack enable pnpm` or `npm i -g pnpm`)
- **Rust** stable + the Tauri 2 system prerequisites for your OS
  (see https://tauri.app/start/prerequisites/)
  - Windows: Microsoft C++ Build Tools + WebView2 (preinstalled on Win 11)
  - macOS: Xcode Command Line Tools
  - Linux: `webkit2gtk`, `librsvg`, etc.

---

## Setup & run

```bash
# 1. Install frontend deps
pnpm install

# 2. Install sidecar deps
pnpm sidecar:install

# 3. Build the sidecar into a self-contained binary named with your target
#    triple (e.g. app-x86_64-pc-windows-msvc.exe) in src-tauri/binaries/
pnpm sidecar:build

# 4. (first time) Generate the app icon set from the bundled source PNG
node src-tauri/generate-icon.cjs  # writes src-tauri/icons/icon.png
pnpm icons                        # tauri icon -> full platform icon set

# 5. Run in development
pnpm tauri dev
```

> The sidecar binary must exist **before** `tauri dev`/`tauri build`, because
> Tauri resolves `externalBin` at bundle time. Re-run `pnpm sidecar:build`
> whenever you change anything under `sidecar/`.
>
> pnpm blocks package build scripts by default; the root and sidecar
> `package.json` both allow `esbuild` via `pnpm.onlyBuiltDependencies` so Vite
> and pkg work. Approve any future ones with `pnpm approve-builds`.

### Build a distributable

```bash
pnpm build:desktop         # sidecar:build + tauri build
# or explicitly:
pnpm sidecar:build
pnpm tauri build
```

Installers/bundles are emitted under `src-tauri/target/release/bundle/`.

---

## Scripts

| Script                   | What it does                                        |
| ------------------------ | --------------------------------------------------- |
| `pnpm dev`               | Vite dev server only (browser preview, no eval)     |
| `pnpm tauri dev`         | Full desktop app in dev                             |
| `pnpm sidecar:install`   | `pnpm install` inside `sidecar/`                    |
| `pnpm sidecar:build`     | Compile sidecar → `src-tauri/binaries/app-<triple>` |
| `pnpm icons`             | Generate platform icons from `icons/icon.png`       |
| `pnpm build:desktop`     | Build sidecar + `tauri build`                       |

---

## Modules & auto-install

`import` / `require` work in the playground:

- **Node builtins** (`crypto`, `fs`, `path`, `util`, …) are available directly.
- **npm packages** are **auto-installed on demand**. Type `import _ from "lodash"`
  and the sidecar installs `lodash` into a per-user cache
  (`~/.runnit/packages`) while the output panel shows an *Installing lodash…*
  banner; the code runs as soon as it's ready. Subsequent runs are instant
  (cached).

The frontend transpiles with esbuild `format: "cjs"`, so imports become
`require()` calls the sidecar resolves. Detection is done on the AST in
`sidecar/index.js`; installs are de-duplicated and run with **`--ignore-scripts`**
so a package's postinstall can't execute code just because its name was typed.
`require`, `module`, `process`, `Buffer`, timers, `TextEncoder`, `URL`, etc. are
exposed in the vm context (`sidecar/worker-src.js`).

> Security note: with `require` + `fs` available this is effectively a local
> Node runtime — only run code you trust. To flip the safety/compat tradeoff,
> change the `runNpmInstall` flags in `sidecar/index.js` (e.g. drop
> `--ignore-scripts`), or set `RUNNIT_CACHE_DIR` to relocate the package cache.

## Files, tabs & shortcuts

Documents live in tabs and auto-persist to `localStorage`. You can also read/write
real files on disk via the native dialog:

| Shortcut            | Action                          |
| ------------------- | ------------------------------- |
| `Ctrl/⌘ + S`        | Save (Save As if never saved)   |
| `Ctrl/⌘ + Shift + S`| Save As…                        |
| `Ctrl/⌘ + O`        | Open a file (new tab)           |
| `Ctrl/⌘ + T`        | New tab                         |
| `Ctrl/⌘ + W`        | Close tab                       |
| `Ctrl/⌘ + 1…9`      | Jump to tab N                   |

A saved tab shows its filename; an amber dot marks unsaved changes. File I/O uses
`tauri-plugin-dialog` + two tiny Rust commands (`write_file` / `read_file`).

## Notes & limitations

- The 3 s timeout is set in `sidecar/index.js` (`TIMEOUT_MS`).
- Auto-install needs `npm` on `PATH`. If it's missing, the install fails
  gracefully and the error surfaces in the output panel.
- Async output (from `setTimeout`/promises) may not be captured — the vm result
  is read once the top-level (synchronous) code finishes.
- For crisp code rendering, install **JetBrains Mono** (or Fira/Cascadia Code);
  the app falls back to your platform's monospace otherwise.
```
