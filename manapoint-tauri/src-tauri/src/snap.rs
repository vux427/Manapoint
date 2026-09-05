//! Pure geometry for snapping a window to screen edges. Each axis independently looks
//! at which end of the work area it is near and snaps only to the nearer one; if both
//! ends are far it stays put. That gives all four corners and all four edges for free,
//! and leaves a window dragged through the middle completely alone.
//!
//! No window-system calls, so it is directly testable.

/// Snap distance, in logical pixels. Convert with [`threshold_for`] before comparing,
/// since the rectangles are physical.
///
/// Deliberately small: snapping happens live during the drag, so every pixel of this is
/// a band where the window stops tracking the cursor. Wide enough to catch an edge on
/// purpose, narrow enough that the panel never feels welded to one.
pub const DEFAULT_THRESHOLD: i32 = 16;

/// Tolerance for "still flush against that edge", absorbing DPI rounding.
const FLUSH_TOLERANCE: i32 = 2;

/// A monitor's work area in physical pixels, taskbar already excluded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkArea {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// The threshold is defined in logical pixels so the grab distance feels the same on a
/// 150% display as on a 100% one.
pub fn threshold_for(scale_factor: f64) -> i32 {
    ((DEFAULT_THRESHOLD as f64 * scale_factor).round() as i32).max(1)
}

/// Snap a window's top-left corner to the work area edges. Physical pixels throughout.
pub fn snap(pos: (i32, i32), size: (i32, i32), area: WorkArea, threshold: i32) -> (i32, i32) {
    (
        snap_axis(pos.0, size.0, area.left, area.right, threshold),
        snap_axis(pos.1, size.1, area.top, area.bottom, threshold),
    )
}

/// Keep whichever edge the window was already flush against when its size changes.
/// A refresh that makes the cards taller must not push a bottom-anchored panel off the
/// screen. Any edge it was not touching is left alone.
pub fn keep_edges(
    pos: (i32, i32),
    old_size: (i32, i32),
    new_size: (i32, i32),
    area: WorkArea,
) -> (i32, i32) {
    (
        keep_axis(pos.0, old_size.0, new_size.0, area.left, area.right),
        keep_axis(pos.1, old_size.1, new_size.1, area.top, area.bottom),
    )
}

fn snap_axis(raw: i32, len: i32, lo: i32, hi: i32, threshold: i32) -> i32 {
    let hi_pos = hi - len;
    let to_lo = (raw - lo).abs();
    let to_hi = (raw - hi_pos).abs();

    if to_lo > threshold && to_hi > threshold {
        return raw;
    }
    if to_lo <= to_hi { lo } else { hi_pos }
}

fn keep_axis(raw: i32, old_len: i32, new_len: i32, lo: i32, hi: i32) -> i32 {
    if (raw - lo).abs() <= FLUSH_TOLERANCE {
        return lo;
    }
    if (raw + old_len - hi).abs() <= FLUSH_TOLERANCE {
        return hi - new_len;
    }
    raw
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: WorkArea = WorkArea { left: 0, top: 0, right: 1920, bottom: 1040 };
    const SIZE: (i32, i32) = (252, 300);

    #[test]
    fn snaps_to_top_left_corner() {
        assert_eq!((0, 0), snap((10, 10), SIZE, AREA, DEFAULT_THRESHOLD));
    }

    #[test]
    fn snaps_to_bottom_right_corner() {
        assert_eq!(
            (1920 - 252, 1040 - 300),
            snap((1680, 750), SIZE, AREA, DEFAULT_THRESHOLD)
        );
    }

    /// Axes are independent: hugging the left edge must not move the window vertically.
    #[test]
    fn snaps_left_edge_only() {
        assert_eq!((0, 500), snap((5, 500), SIZE, AREA, DEFAULT_THRESHOLD));
    }

    #[test]
    fn snaps_right_edge_only() {
        assert_eq!(
            (1920 - 252, 500),
            snap((1920 - 252 + 5, 500), SIZE, AREA, DEFAULT_THRESHOLD)
        );
    }

    /// Nothing happens in open space. This is the "must not affect the feel" guarantee.
    #[test]
    fn leaves_window_alone_outside_threshold() {
        assert_eq!((100, 100), snap((100, 100), SIZE, AREA, DEFAULT_THRESHOLD));
    }

    /// Exactly at the threshold still snaps.
    #[test]
    fn snaps_at_exact_threshold() {
        assert_eq!((0, 100), snap((16, 100), SIZE, AREA, 16));
    }

    /// One pixel past it does not — this is the escape hatch that keeps a snapped
    /// window from feeling welded to the edge.
    #[test]
    fn releases_one_pixel_past_the_threshold() {
        assert_eq!((17, 100), snap((17, 100), SIZE, AREA, 16));
    }

    /// With both ends in range it takes the nearer one instead of always falling
    /// towards the origin.
    #[test]
    fn picks_the_nearer_edge_when_both_in_range() {
        let area = WorkArea { left: 0, top: 0, right: 300, bottom: 400 };
        let size = (260, 360); // flush right = 40, flush bottom = 40

        // x=30 is 30 from the left, 10 from the right -> right wins.
        // y=5 is 5 from the top, 35 from the bottom -> top wins.
        assert_eq!((40, 0), snap((30, 5), size, area, 40));
    }

    #[test]
    fn threshold_scales_with_dpi() {
        assert_eq!(16, threshold_for(1.0));
        assert_eq!(20, threshold_for(1.25));
        assert_eq!(24, threshold_for(1.5));
        assert_eq!(32, threshold_for(2.0));
    }

    /// Content grows while flush against the bottom: the window rides up to stay flush.
    #[test]
    fn keeps_bottom_edge_when_content_grows() {
        let pos = (1668, 1040 - 300);
        assert_eq!((1668, 1040 - 380), keep_edges(pos, SIZE, (252, 380), AREA));
    }

    /// The top-left is the anchor already, so growing needs no move.
    #[test]
    fn keeps_top_left_anchor_untouched() {
        assert_eq!((0, 0), keep_edges((0, 0), SIZE, (252, 380), AREA));
    }

    #[test]
    fn leaves_floating_window_alone_on_resize() {
        assert_eq!((500, 400), keep_edges((500, 400), SIZE, (252, 380), AREA));
    }
}
