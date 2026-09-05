// Release builds are GUI-subsystem, so double-clicking the exe does not also open a
// console window and leave it sitting on the desktop for as long as the app runs.
// Debug builds keep the console — that is where panics and logs come out during dev.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    manapoint_lib::run()
}
