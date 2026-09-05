//! Win32 bits Tauri does not expose: the work area, and live edge snapping while the
//! user drags the window.

use crate::snap::WorkArea;

/// Work area (taskbar excluded) of the monitor the window is on.
///
/// Tauri's `current_monitor()` reports the whole screen, so snapping to it would tuck
/// the panel underneath the taskbar. Ask Win32 for `rcWork` instead.
#[cfg(windows)]
pub fn work_area(hwnd: isize) -> Option<WorkArea> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };

    // SAFETY: hwnd comes from Tauri and is alive; cbSize is filled per the API contract.
    // MONITOR_DEFAULTTONEAREST still answers for a window dragged off-screen.
    let ok = unsafe {
        let monitor = MonitorFromWindow(HWND(hwnd as *mut _), MONITOR_DEFAULTTONEAREST);
        GetMonitorInfoW(monitor, &mut info).as_bool()
    };
    if !ok {
        return None;
    }

    let r = info.rcWork;
    Some(WorkArea { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
}

#[cfg(not(windows))]
pub fn work_area(_hwnd: isize) -> Option<WorkArea> {
    None
}

/// Make the window snap to screen edges *while* it is being dragged.
///
/// The window is moved by the OS's own modal drag loop, which asks the window where it
/// is allowed to go by sending WM_MOVING with a proposed rectangle the app may rewrite.
/// Rewriting it there is what makes the magnetism feel native: the OS paints the window
/// at the snapped position itself, so there is no second mover to fight and nothing to
/// jitter. (Repositioning the window from another thread during that loop, or waiting
/// for the drag to end and jumping, both feel wrong — one stutters, the other lurches.)
#[cfg(windows)]
pub fn install_drag_snap(hwnd: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::SetWindowSubclass;

    // SAFETY: the window outlives the process here (it is the panel), and the subclass
    // proc below only reads the message it is given.
    unsafe { SetWindowSubclass(HWND(hwnd as *mut _), Some(snap_subclass), SUBCLASS_ID, 0).as_bool() }
}

#[cfg(not(windows))]
pub fn install_drag_snap(_hwnd: isize) -> bool {
    false
}

#[cfg(windows)]
const SUBCLASS_ID: usize = 0x4d50; // "MP"

/// Where inside the window the user grabbed it, captured when the drag starts.
///
/// The snapped position is always recomputed from the live cursor, never from the
/// rectangle the OS proposes. That rectangle is the one we rewrote on the previous
/// message, so snapping off it compounds: the window welds itself to the edge and no
/// amount of pulling frees it. Deriving from the cursor means escaping always costs
/// exactly one threshold of movement, no matter how long it has been stuck to an edge.
#[cfg(windows)]
static GRAB: (
    std::sync::atomic::AtomicI32,
    std::sync::atomic::AtomicI32,
    std::sync::atomic::AtomicBool,
) = (
    std::sync::atomic::AtomicI32::new(0),
    std::sync::atomic::AtomicI32::new(0),
    std::sync::atomic::AtomicBool::new(false),
);

#[cfg(windows)]
unsafe extern "system" fn snap_subclass(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use std::sync::atomic::Ordering;
    use windows::Win32::Foundation::{LRESULT, POINT, RECT};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetWindowRect, WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_MOVING,
    };

    match msg {
        WM_ENTERSIZEMOVE => {
            let mut cursor = POINT::default();
            let mut rect = RECT::default();
            // SAFETY: both take out-parameters we own; hwnd is the live panel window.
            let ok = unsafe {
                GetCursorPos(&mut cursor).is_ok() && GetWindowRect(hwnd, &mut rect).is_ok()
            };
            if ok {
                GRAB.0.store(cursor.x - rect.left, Ordering::Relaxed);
                GRAB.1.store(cursor.y - rect.top, Ordering::Relaxed);
                GRAB.2.store(true, Ordering::Relaxed);
            }
        }
        WM_EXITSIZEMOVE => GRAB.2.store(false, Ordering::Relaxed),
        WM_MOVING => {
            let proposed = lparam.0 as *mut RECT;
            if !proposed.is_null() && GRAB.2.load(Ordering::Relaxed) {
                let mut cursor = POINT::default();
                // SAFETY: out-parameter we own.
                if unsafe { GetCursorPos(&mut cursor) }.is_ok() {
                    if let Some(area) = work_area(hwnd.0 as isize) {
                        let r = unsafe { *proposed };
                        let (w, h) = (r.right - r.left, r.bottom - r.top);

                        // Unsnapped position, straight from the cursor.
                        let raw = (
                            cursor.x - GRAB.0.load(Ordering::Relaxed),
                            cursor.y - GRAB.1.load(Ordering::Relaxed),
                        );

                        // The threshold is in logical pixels, so a 150% display keeps
                        // the same physical grab distance as a 100% one.
                        let dpi = unsafe { GetDpiForWindow(hwnd) };
                        let scale = if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 };

                        let (x, y) =
                            crate::snap::snap(raw, (w, h), area, crate::snap::threshold_for(scale));

                        unsafe {
                            (*proposed).left = x;
                            (*proposed).top = y;
                            (*proposed).right = x + w;
                            (*proposed).bottom = y + h;
                        }
                        // TRUE tells the loop the rectangle was adjusted.
                        return LRESULT(1);
                    }
                }
            }
        }
        _ => {}
    }

    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}
