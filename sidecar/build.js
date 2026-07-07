#!/usr/bin/env node
"use strict";
// ---------------------------------------------------------------------------
// Compiles the Node sidecar to a self-contained binary with @yao-pkg/pkg and
// drops it into ../src-tauri/binaries/ named with the Rust target triple, which
// is exactly what Tauri's `externalBin` sidecar resolution expects, e.g.
//   app-x86_64-pc-windows-msvc.exe
//   app-aarch64-apple-darwin
//
// The target triple is read from `rustc -Vv` (host:) so the sidecar always
// matches the machine Tauri is building for.
// ---------------------------------------------------------------------------
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SIDECAR_DIR = __dirname;
const OUT_DIR = path.resolve(SIDECAR_DIR, "..", "src-tauri", "binaries");
const BASENAME = "app"; // must match externalBin "binaries/app" in tauri.conf.json

function rustHostTriple() {
  const out = execSync("rustc -Vv", { encoding: "utf8" });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("host:"));
  if (!line) throw new Error("Could not read `host:` from `rustc -Vv`. Is Rust installed?");
  return line.replace("host:", "").trim();
}

// Map a Rust triple -> the @yao-pkg/pkg target token (node22-<platform>-<arch>).
function pkgTarget(triple) {
  const isWin = triple.includes("windows");
  const isMac = triple.includes("apple") || triple.includes("darwin");
  const isArm = triple.startsWith("aarch64") || triple.startsWith("arm");

  const platform = isWin ? "win" : isMac ? "macos" : "linux";
  const arch = isArm ? "arm64" : "x64";
  return "node22-" + platform + "-" + arch;
}

function main() {
  const triple = rustHostTriple();
  const target = pkgTarget(triple);
  const ext = triple.includes("windows") ? ".exe" : "";
  const outFile = path.join(OUT_DIR, BASENAME + "-" + triple + ext);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("[build] rust host triple : " + triple);
  console.log("[build] pkg target       : " + target);
  console.log("[build] output           : " + outFile);

  // Invoke the local @yao-pkg/pkg via `pnpm exec` (resolves ./node_modules/.bin).
  const args = ["exec", "pkg", ".", "--target", target, "--output", outFile];

  const res = spawnSync("pnpm", args, {
    cwd: SIDECAR_DIR,
    stdio: "inherit",
    shell: process.platform === "win32", // pnpm is a .cmd on Windows
  });

  if (res.status !== 0) {
    console.error("[build] pkg failed. Run `pnpm install` inside ./sidecar first.");
    process.exit(res.status || 1);
  }

  if (!fs.existsSync(outFile)) {
    console.error("[build] expected output not found: " + outFile);
    process.exit(1);
  }
  console.log("[build] done -> " + outFile);
}

main();
