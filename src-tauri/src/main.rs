// Prevents an extra Windows console from opening alongside the application window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    erp_sahel_desktop_lib::run()
}
