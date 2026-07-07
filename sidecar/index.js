#!/usr/bin/env node
"use strict";
// ---------------------------------------------------------------------------
// runnit sidecar (persistent evaluator)
//
// Protocol: one JSON object per line on stdin, one JSON object per line on
// stdout. Anything the sidecar itself needs to log goes to stderr so stdout
// stays a clean channel Rust can line-parse.
//
//   in : { "id": 123, "code": "<transpiled cjs>", "map": "<esbuild sourcemap>" }
//   out (result)  : { "id", "logs", "results", "error" }
//   out (progress): { "type":"progress", "id", "status", "pkg", "message" }
//
// Pipeline per request:
//   1. Build a SourceMapConsumer so captured lines map back to editor lines.
//   2. Parse the transpiled JS, INSTRUMENT top-level statements for per-line
//      capture, and COLLECT `require("pkg")` specifiers.
//   3. Auto-install any missing npm packages into a per-user cache dir
//      (emitting progress events), so the sandbox's `require` can resolve them.
//   4. Run the instrumented code in a fresh vm context inside a worker thread,
//      with `require` (builtins + cached npm packages) and Node globals exposed.
// ---------------------------------------------------------------------------
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { Worker } = require("worker_threads");
const Module = require("module");
const parser = require("@babel/parser");
const t = require("@babel/types");

const generatorModule = require("@babel/generator");
const generate = generatorModule.default || generatorModule;

const { SourceMapConsumer } = require("source-map");

const TIMEOUT_MS = 3000;

// Where auto-installed npm packages live (persist across sessions).
const CACHE_DIR =
  process.env.RUNNIT_CACHE_DIR || path.join(os.homedir(), ".runnit", "packages");
const CACHE_ANCHOR = path.join(CACHE_DIR, "__anchor.js");

const WORKER_SRC = fs.readFileSync(path.join(__dirname, "worker-src.js"), "utf8");

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const pkgJson = path.join(CACHE_DIR, "package.json");
  if (!fs.existsSync(pkgJson)) {
    fs.writeFileSync(
      pkgJson,
      JSON.stringify({ name: "runnit-packages", private: true, version: "0.0.0" }, null, 2)
    );
  }
}
ensureCacheDir();

// A require anchored at the cache dir: resolves builtins AND installed packages.
const cacheRequire = Module.createRequire(CACHE_ANCHOR);

// ---------------------------------------------------------------------------
// AST: instrumentation + require collection
// ---------------------------------------------------------------------------

function mapNodeLine(consumer, node) {
  if (!node || !node.loc) return 0;
  // Prefer the statement's END position: esbuild rewrites references to
  // imported bindings so the statement START token (`import_x.default…`) maps
  // back to the import line, not the user's line. The tail is user-authored.
  const end = node.loc.end;
  const start = node.loc.start;
  if (!consumer) return (end || start).line;
  const oEnd = end && consumer.originalPositionFor({ line: end.line, column: Math.max(0, end.column - 1) });
  if (oEnd && oEnd.line) return oEnd.line;
  const oStart = start && consumer.originalPositionFor({ line: start.line, column: start.column });
  return oStart && oStart.line ? oStart.line : (start || end).line;
}

function captureCall(line, expr) {
  return t.callExpression(t.identifier("__capture"), [t.numericLiteral(line), expr]);
}
function setLineStmt(line) {
  return t.expressionStatement(
    t.callExpression(t.identifier("__setLine"), [t.numericLiteral(line)])
  );
}

// Lightweight recursive AST walk (no @babel/traverse dependency).
function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments")
      continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) if (c && typeof c.type === "string") walk(c, visit);
    } else if (child && typeof child.type === "string") {
      walk(child, visit);
    }
  }
}

// esbuild names its injected helpers/imports with a leading __ or import_.
function isInjectedName(name) {
  return typeof name === "string" && (/^__/.test(name) || /^import_/.test(name));
}
function isInjectedId(id) {
  return id && id.type === "Identifier" && isInjectedName(id.name);
}
// A call to require()/__toESM()/__require()/__commonJS()/__export()… — module
// plumbing, not a user value worth showing.
const MODULE_CALLEES = new Set([
  "require",
  "__require",
  "__toESM",
  "__toCommonJS",
  "__commonJS",
  "__export",
  "__reExport",
  "__copyProps",
]);
function isRequireish(node) {
  return (
    node &&
    node.type === "CallExpression" &&
    node.callee &&
    node.callee.type === "Identifier" &&
    MODULE_CALLEES.has(node.callee.name)
  );
}
// A whole top-level statement that is pure esbuild plumbing (skip entirely).
function isInjectedStatement(node) {
  if (node.type === "VariableDeclaration") {
    return node.declarations.every(
      (d) => isInjectedId(d.id) || (d.init && isRequireish(d.init))
    );
  }
  if (node.type === "ExpressionStatement") {
    const e = node.expression;
    if (e && e.type === "CallExpression" && e.callee && e.callee.type === "Identifier") {
      return isInjectedName(e.callee.name) || e.callee.name === "require";
    }
    // `0 && (module.exports = ...)` style guards esbuild sometimes emits.
    if (e && e.type === "LogicalExpression") return true;
  }
  return false;
}

function basePackage(spec) {
  if (spec.startsWith("node:")) return spec.slice(5);
  if (spec.startsWith("@")) return spec.split("/").slice(0, 2).join("/");
  return spec.split("/")[0];
}

// Returns { code, specs } where specs are bare, non-builtin require specifiers.
function instrument(code, consumer) {
  const ast = parser.parse(code, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  });

  // Collect require("...") specifiers.
  const specs = new Set();
  walk(ast.program, (node) => {
    if (
      node.type === "CallExpression" &&
      node.callee &&
      node.callee.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments.length === 1 &&
      node.arguments[0].type === "StringLiteral"
    ) {
      const spec = node.arguments[0].value;
      if (spec && !spec.startsWith(".") && !spec.startsWith("/") && !Module.isBuiltin(spec)) {
        specs.add(spec);
      }
    }
  });

  // Instrument top-level statements for per-line capture — while skipping the
  // helper prelude esbuild injects for cjs/import interop (`__create`,
  // `__toESM`, `var import_x = require(...)`, the `"use strict"` directive…).
  // Capturing those would dump whole modules and clutter line 1.
  const body = ast.program.body;
  const newBody = [];
  for (const node of body) {
    if (isInjectedStatement(node)) {
      newBody.push(node); // keep it, but don't setLine/capture it
      continue;
    }

    const stmtLine = mapNodeLine(consumer, node);

    if (t.isExpressionStatement(node)) {
      // Skip directives like "use strict".
      if (t.isStringLiteral(node.expression)) {
        newBody.push(node);
        continue;
      }
      newBody.push(setLineStmt(stmtLine));
      const exprLine = mapNodeLine(consumer, node.expression) || stmtLine;
      node.expression = captureCall(exprLine, node.expression);
      newBody.push(node);
    } else if (t.isVariableDeclaration(node)) {
      newBody.push(setLineStmt(stmtLine));
      for (const decl of node.declarations) {
        // Don't capture module bindings (would dump the whole module).
        if (decl.init && !isInjectedId(decl.id) && !isRequireish(decl.init)) {
          const declLine = mapNodeLine(consumer, decl) || stmtLine;
          decl.init = captureCall(declLine, decl.init);
        }
      }
      newBody.push(node);
    } else {
      newBody.push(setLineStmt(stmtLine));
      newBody.push(node);
    }
  }
  ast.program.body = newBody;

  return { code: generate(ast, { compact: false, comments: false }).code, specs: [...specs] };
}

// ---------------------------------------------------------------------------
// npm auto-install (with in-flight de-duplication + progress events)
// ---------------------------------------------------------------------------

const installLocks = new Map(); // base package name -> Promise

function isResolvable(spec) {
  try {
    cacheRequire.resolve(spec);
    return true;
  } catch {
    return false;
  }
}

function runNpmInstall(base) {
  return new Promise((resolve, reject) => {
    // --ignore-scripts: don't run arbitrary postinstall code just because a
    // package name was typed. Safety over compatibility.
    const args = [
      "install",
      base,
      "--prefix",
      CACHE_DIR,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save",
      "--loglevel",
      "error",
    ];
    const child = spawn("npm", args, {
      cwd: CACHE_DIR,
      shell: process.platform === "win32", // npm is npm.cmd on Windows
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => reject(e)); // e.g. npm not found on PATH
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || "npm exited with code " + code));
    });
  });
}

function ensureInstalled(spec, id) {
  const base = basePackage(spec);
  if (isResolvable(spec)) return Promise.resolve();

  if (installLocks.has(base)) return installLocks.get(base);

  send({ type: "progress", id, status: "installing", pkg: base, message: "Installing " + base + "…" });

  const p = runNpmInstall(base)
    .then(() => {
      send({ type: "progress", id, status: "installed", pkg: base, message: base + " installed" });
    })
    .catch((e) => {
      send({
        type: "progress",
        id,
        status: "error",
        pkg: base,
        message: "Could not install " + base + ": " + (e && e.message ? e.message : e),
      });
    })
    .finally(() => {
      installLocks.delete(base);
    });

  installLocks.set(base, p);
  return p;
}

// ---------------------------------------------------------------------------
// Worker execution with hard timeout
// ---------------------------------------------------------------------------

function runInWorker(code) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(value);
    };

    const worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { code, timeoutMs: TIMEOUT_MS, cacheAnchor: CACHE_ANCHOR },
    });

    const timer = setTimeout(() => {
      finish({
        logs: [],
        results: [],
        error: {
          name: "TimeoutError",
          message: "Execution timed out after " + TIMEOUT_MS + "ms (possible infinite loop).",
          stack: null,
        },
      });
    }, TIMEOUT_MS + 500);

    worker.on("message", (m) => finish(m));
    worker.on("error", (e) =>
      finish({
        logs: [],
        results: [],
        error: {
          name: e && e.name ? e.name : "Error",
          message: e && e.message ? String(e.message) : String(e),
          stack: e && e.stack ? String(e.stack) : null,
        },
      })
    );
    worker.on("exit", (codeNum) => {
      if (settled) return;
      finish({
        logs: [],
        results: [],
        error: codeNum
          ? { name: "Error", message: "Worker exited with code " + codeNum, stack: null }
          : null,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handle(msg) {
  const id = msg.id;
  let consumer = null;

  try {
    if (msg.map) {
      try {
        const raw = typeof msg.map === "string" ? JSON.parse(msg.map) : msg.map;
        consumer = new SourceMapConsumer(raw);
      } catch {
        consumer = null;
      }
    }

    let instrumented, specs;
    try {
      const out = instrument(msg.code || "", consumer);
      instrumented = out.code;
      specs = out.specs;
    } catch (e) {
      send({
        id,
        logs: [],
        results: [],
        error: {
          name: e && e.name ? String(e.name) : "SyntaxError",
          message: e && e.message ? String(e.message) : String(e),
          stack: null,
        },
      });
      return;
    }

    // Install any missing npm packages before running (serial, dedup'd).
    for (const spec of specs) {
      await ensureInstalled(spec, id);
    }

    const result = await runInWorker(instrumented);
    send({ id, logs: result.logs || [], results: result.results || [], error: result.error || null });
  } catch (e) {
    send({
      id,
      logs: [],
      results: [],
      error: { name: "SidecarError", message: String(e && e.message ? e.message : e), stack: null },
    });
  } finally {
    if (consumer && typeof consumer.destroy === "function") consumer.destroy();
  }
}

// ---------------------------------------------------------------------------
// stdin loop
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    process.stderr.write("[runnit-sidecar] bad json on stdin\n");
    return;
  }
  handle(msg);
});

rl.on("close", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

process.stderr.write("[runnit-sidecar] ready (cache: " + CACHE_DIR + ")\n");
