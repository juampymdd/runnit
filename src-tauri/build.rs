fn main() {
    // Re-embed window/exe icons when the icon set changes (titlebar + taskbar +
    // desktop icon all come from the icons baked in at compile time).
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
