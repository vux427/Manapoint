# Gemini reset countdown visibility

Gemini's shared five-hour and weekly quotas and Argon's weekly quota already
contained reset timestamps and rendered countdown spans. The grouped mini-meter
CSS hid those spans, leaving reset details accessible only through hover tooltips.

Updated `src/frontend/panel.css` to display each mini-meter's label, percentage,
and reset countdown on one header line above its usage bar. This keeps the
original two-row meter height. Empty countdowns stay hidden, and the separator
used by ordinary meters is suppressed to make room for critical percentages.

Validation:

- All 219 existing Node tests passed.
- Chromium rendered the actual panel with mocked desktop APIs and quota data.
  Countdown visibility, shared header alignment, lack of text overlap, and
  containment passed across
  Graphite, Vitals, Terminal, and Paper in both vertical and horizontal layouts.
- Multiple accounts, 100% usage, and missing cadences were checked in all eight
  theme/layout combinations. Null resets and ordinary meters were also checked.
  No browser script errors occurred. The Vitals preview was visually inspected.
- `git diff --check` passed.

Windows packaging and publication use the repository's Windows release workflow.
