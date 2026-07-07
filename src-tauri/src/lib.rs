// runnit — Tauri backend.
// (window/app icons are embedded via generate_context! from src-tauri/icons)
//
// Owns the lifecycle of the persistent Node sidecar evaluator:
//   * spawn it once at startup and keep it alive,
//   * forward transpiled code to it over stdin (one JSON line per request),
//   * read its stdout, split into JSON lines, and emit each as an
//     `eval-result` event the frontend listens to,
//   * kill the child on app exit so no orphan Node process is left behind.

use std::sync::Mutex;

use tauri::{Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the live sidecar handle. `None` once the child has been killed.
struct SidecarState(Mutex<Option<CommandChild>>);

/// Forward a request to the sidecar. The frontend passes the fully-formed
/// request object ({ id, code, map }); we serialize it as a single line.
#[tauri::command]
fn evaluate(state: State<'_, SidecarState>, request: serde_json::Value) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let child = guard
        .as_mut()
        .ok_or_else(|| "sidecar is not running".to_string())?;

    let mut line = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    line.push('\n');

    child
        .write(line.as_bytes())
        .map_err(|e| format!("failed to write to sidecar: {e}"))
}

/// Write a document to disk (path is chosen by the native dialog on the frontend).
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Read a document from disk.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Spawn the sidecar and wire its stdout stream to the `eval-result` event.
fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (mut rx, child) = app
        .shell()
        .sidecar("app")?
        .spawn()?;

    app.manage(SidecarState(Mutex::new(Some(child))));

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // stdout can arrive in arbitrary chunks; buffer and split on newlines.
        let mut buffer = String::new();

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(idx) = buffer.find('\n') {
                        let line: String = buffer.drain(..=idx).collect();
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<serde_json::Value>(line) {
                            Ok(value) => {
                                // Progress (install) events vs. evaluation results
                                // travel on separate Tauri events.
                                let is_progress = value
                                    .get("type")
                                    .and_then(|v| v.as_str())
                                    == Some("progress");
                                let event = if is_progress { "eval-progress" } else { "eval-result" };
                                let _ = handle.emit(event, value);
                            }
                            Err(err) => {
                                eprintln!("[runnit] bad json from sidecar: {err}");
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    // Sidecar diagnostics (e.g. "ready"); surface for debugging.
                    eprint!("[sidecar] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(err) => {
                    eprintln!("[runnit] sidecar error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[runnit] sidecar terminated: {payload:?}");
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Kill the sidecar if it is still running (idempotent).
fn kill_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![evaluate, write_file, read_file])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(err) = spawn_sidecar(&handle) {
                eprintln!("[runnit] failed to spawn sidecar: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Ensure the Node child dies with the app — no orphan processes.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                kill_sidecar(app_handle);
            }
        });
}
