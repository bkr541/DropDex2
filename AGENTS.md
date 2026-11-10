# Codex instructions

## Usage and scope discipline

- Treat the user's token and usage budget as a hard constraint. Complete the requested scope with the fewest necessary tool calls, reads, and validations.
- Do not over-engineer setup, planning, baseline, or harness phases. Build only what the requested phase requires.
- Run one proportional, focused validation pass after implementation. Do not repeat expensive builds, browser captures, broad checks, or visual reviews unless a subsequent code change could invalidate them.
- When work is divided into phases, implement only the phase the user requested. Do not begin later phases or optional improvements.
- If a check is known to fail for unrelated reasons, report it once and do not rerun it unless the current change plausibly affects that failure.

## Explicit user preference: stop unnecessary verification

- Stop once implementation and the necessary checks are complete. The user strongly objects to wasting credits on extra verification.
- Do not repeatedly launch Electron, reconnect UI automation, or retry optional visual checks after the relevant tests and build pass.
- If an optional visual check is unavailable or fails, report the limitation and finish. Retry only if the user requests it or a concrete unresolved issue makes the check necessary.
- Acknowledge and persist explicit workflow preferences instead of merely promising to remember them.

## Audio record lists

Use RecordTrackListing for production lists of user audio records. The Audition table is the visual reference. Its shared columns, in order, are Track, BPM, Key, Genre, Format, Playlists, Date added, Duration and Actions. Use its built-in waveform and cue dots. Put workflow details and actions in the shared Actions slot. Use a dash for unavailable metadata and keep the same column layout. Scope screen styles to the surrounding workspace.

## Discovery retrieval

Use the existing Playwright/Chromium and Selectolax browser-scraping workflow for SoundCloud Discovery, as used for 1001Tracklists. Do not replace this with a credentialed SoundCloud API integration unless the user explicitly requests it.

## Shared track timeline

The Library's five-row waveform region is the canonical reference. Cue Points, Audition, Drop Lab, Set Lab (including repositioning), and Flip Lab must render `TrackTimeline` from `src/components/ui/media/TrackTimeline.tsx`. It owns phrases → timestamps → cues → waveform → beat grid, row dimensions, padding, gaps, typography, cue lines, waveform rendering, and beat styling. Keep all five rows reserved when metadata is missing. Supply data, positioned waveform layers, and workflow interaction handlers/overlays; do not reconstruct the rows or override their internals in screen CSS. Visual variants require an explicit user request. Orange drop/chorus phrase and waveform highlighting is Audition-only (`highlightDrops`); all other screens use the standard slate color throughout. Pass an explicit full-track gray color segment for the standard waveform: tint alone does not override Rekordbox spectral colors in the area renderer. Keep 12px outer padding on all four sides of the shared component; reserve the timeline lead-in inside the content rather than adding it to the outer padding. For timeline changes, run one focused check of shared row geometry and the affected workflow; do not repeatedly launch Electron or perform optional captures.

## Application audio dock

Layout Lab → Audio Dock → 01 (Essential Strip) is the production bottom dock reference. The mockup and live player share `EssentialAudioDock` and its CSS. Mount `NowPlayingBar` once in the app layout, including idle and Audition screens. Standard playback uses `AudioPlayerContext` and the mounted workspace's track queue. Drop Lab transition preview, Set Lab sequencing, and Flip Lab stems use independent Web Audio engines: show the bottom dock disabled there and preserve their existing controls and engines until explicitly asked to integrate them.

## Profile and USB presentation

Profile tabs and nested content groups must show the parent background, with transparent group surfaces. Use shared ControlButton primary/secondary styles for ordinary Profile actions (Save Profile primary, Sign Out secondary); do not override their presentation in Profile CSS. USB Management uses the shared studio-surface around every tab, transparent nested panels, shared controls and feedback, and coral accent tokens scoped to that workspace. Do not reintroduce glass cards, black inset group backgrounds, or decorative drive-card glows.

My USBs displays one full-width USB record per row in a single vertical column. Keep its identity header compact and its actions icon-only using ToolbarIconGroup/ToolbarIconButton with accessible labels. Expanded playlists and RecordTrackListing tracks must fit the record width without horizontal scrolling; wrap long text and stack labeled metadata at narrow widths, preserving every shared field and waveform.

Audio track listing headers use sentence case (only the first letter capitalized). Track-record Genre columns use 83.2px and wrap long values. Editing must use a full-width floating portal above the listing, keeping the displayed cell in place so opening the input or showing save errors cannot resize columns. Genre inputs have no leading icon and use the search input's underline-only focus style.

Cue Points' Tracks/Playlists source switch is its own `TrackSourceTabs` component, in a full-width tab row above the filter row, laid out like the Library page's tab row (16px side padding, hairline underneath). It shares Library tab styling (icon beside text and active underline), not Library's component ownership.

## Accent tokens

Use `--color-control-primary` and `--color-control-primary-rgb` for the standard coral-red UI accent, and `--color-control-primary-hover` for hover/focus. Do not reintroduce `--color-control-blue` tokens or local blue-to-red overrides.

## Icon toolbar rows

Use `ToolbarRow` (`src/components/ui/controls/ToolbarRow.tsx`) for any band of icon-only toolbar buttons. It owns the band (right-justified, 16px side padding, hairline) and the shared icon-button look in `toolbar-row.css`. Cue Points and Audition's Keep / Maybe / Remove both use it. Do not rebuild the band or scope its styles to a screen class.
