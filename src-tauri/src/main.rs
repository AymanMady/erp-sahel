// Empêche l'ouverture d'une console Windows en plus de la fenêtre applicative.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    erp_sahel_desktop_lib::run()
}
