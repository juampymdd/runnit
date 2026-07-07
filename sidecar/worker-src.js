"use strict";
// ---------------------------------------------------------------------------
// runnit worker source.
//
// This file is loaded as a STRING by index.js and executed via
// `new Worker(src, { eval: true })`. Keeping it as an inlined string (instead
// of a separate module referenced by path) is what makes the sidecar
// packageable with @yao-pkg/pkg: pkg cannot trace a dynamic Worker path, but
// an eval:true worker that only touches Node built-ins (vm, util,
// worker_threads) needs nothing bundled.
//
// It receives already-INSTRUMENTED code (see index.js `instrument`) whose
// top-level statements are wrapped with __setLine(n) / __capture(line, value).
// It runs that code in a fresh vm context with a sandboxed console, then posts
// { logs, results, error } back to the parent. The parent enforces the hard
// timeout by terminating this worker if it never replies.
// ---------------------------------------------------------------------------
const { parentPort, workerData } = require("worker_threads");
const vm = require("vm");
const util = require("util");
const Module = require("module");

const code = workerData.code;
const timeoutMs = workerData.timeoutMs;

// A `require` anchored at the cache dir so user code can pull in Node builtins
// AND auto-installed npm packages (the sidecar installs them before we run).
const sandboxRequire = Module.createRequire(workerData.cacheAnchor);

const logs = [];
const results = [];
let currentLine = 0;

function inspectVal(v) {
  try {
    return util.inspect(v, {
      depth: 4,
      breakLength: 80,
      maxArrayLength: 200,
      maxStringLength: 10000,
      getters: false,
    });
  } catch (e) {
    return String(v);
  }
}

// console.log("x", 1) should print:  x 1   (strings raw, everything else inspected)
function formatLogArgs(args) {
  return args
    .map(function (a) {
      return typeof a === "string" ? a : inspectVal(a);
    })
    .join(" ");
}

const sandboxConsole = {};
["log", "info", "warn", "error", "debug", "trace"].forEach(function (level) {
  sandboxConsole[level] = function () {
    logs.push({
      level: level,
      line: currentLine,
      text: formatLogArgs(Array.prototype.slice.call(arguments)),
    });
  };
});

// CommonJS module scaffolding so `require`, `module.exports`, `exports`,
// `__dirname`/`__filename` all behave like a normal Node module.
const sandboxModule = { exports: {} };

const context = {
  console: sandboxConsole,
  require: sandboxRequire,
  module: sandboxModule,
  exports: sandboxModule.exports,
  __dirname: ".",
  __filename: "runnit-eval.js",
  // Node globals commonly reached for in a playground.
  process: process,
  Buffer: Buffer,
  global: undefined, // set below to the context itself
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  setImmediate: setImmediate,
  queueMicrotask: queueMicrotask,
  TextEncoder: TextEncoder,
  TextDecoder: TextDecoder,
  URL: URL,
  URLSearchParams: URLSearchParams,
  // Set the "current top-level statement line" so captured console output can
  // be attributed to the right editor line.
  __setLine: function (n) {
    currentLine = n;
  },
  // Capture the value of a top-level expression / declaration and return it
  // unchanged so evaluation semantics are preserved.
  __capture: function (line, value) {
    if (value !== undefined) {
      results.push({ line: line, value: inspectVal(value) });
    }
    return value;
  },
};
context.global = context;
context.globalThis = context;
vm.createContext(context);

let error = null;
try {
  const script = new vm.Script(code, { filename: "runnit-eval.js" });
  // The vm `timeout` interrupts synchronous runaway loops. The parent adds a
  // worker.terminate() backstop for anything the vm timeout can't reach.
  script.runInContext(context, { timeout: timeoutMs });
} catch (e) {
  error = {
    name: e && e.name ? String(e.name) : "Error",
    message: e && e.message ? String(e.message) : String(e),
    stack: e && e.stack ? String(e.stack) : null,
  };
}

parentPort.postMessage({ logs: logs, results: results, error: error });
