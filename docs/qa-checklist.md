# DropDex Manual QA Checklist

Test these scenarios manually before each release. Each scenario lists the expected outcome.

---

## 1. Fresh complete import

**Setup:** Clean Supabase project (no imports). USB drive with full Rekordbox export including ANLZ files.

- [ ] Click "Import Library" → file picker opens.
- [ ] Select `exportLibrary.db` from `PIONEER/rekordbox/` on USB.
- [ ] Progress bar appears; track and playlist counts increment.
- [ ] After completion, Library view shows tracks, playlists, and key stats.
- [ ] Analysis status banner does **not** appear (analysis completed).
- [ ] Waveforms are visible in the Tracks tab for tracks that have EXT/DAT files.

---

## 2. Partial import (missing EXT files)

**Setup:** USB drive where some or all EXT files are missing (DAT files present).

- [ ] Import completes without error.
- [ ] Analysis banner shows "Analysis Incomplete — Some tracks are missing waveform…".
- [ ] Tracks with DAT-only waveforms show the active theme’s monochrome waveform treatment.
- [ ] Tracks with color (EXT) waveforms show colored bars.
- [ ] Tracks with no ANLZ files at all show "No waveform" placeholder.

---

## 3. Resume import (partial upload, then resume)

**Setup:** Start import, disconnect USB mid-upload (or simulate by cancelling).

- [ ] Import marks `analysis_status = partial`.
- [ ] Library banner shows "Analysis Incomplete" with "Resume Analysis" button.
- [ ] Click "Resume Analysis" → `ResumeAnalysisModal` opens.
- [ ] Re-connect USB → scan finds remaining files.
- [ ] Only unresolved files appear in the upload list (previously uploaded files are excluded).
- [ ] After resume upload, banner disappears or shows "completed".
- [ ] No duplicate waveform rows created (database remains consistent).

---

## 4. Color waveform (EXT present)

**Setup:** Track that has both `.DAT` and `.EXT` ANLZ files.

- [ ] Track row in Tracks tab shows waveform with RGB colors (blues, oranges, whites).
- [ ] Track Detail view shows same waveform at larger size.
- [ ] Colors match what Rekordbox shows for that track.
- [ ] Waveform does not revert to monochrome on theme switch.

---

## 5. Monochrome waveform fallback (no EXT)

**Setup:** Track with `.DAT` only (no `.EXT`).

- [ ] Dark and Light use the existing DropDex coral waveform; CDJ uses blue/cyan monochrome bars.
- [ ] Intensity gradient visible (some bars lighter/darker).
- [ ] "No waveform" placeholder does **not** appear.
- [ ] Track Detail shows same monochrome waveform.

---

## 6. USB connected — audio playback

**Setup:** Chromium-based browser, USB connected, library imported.

- [ ] USB button in sidebar shows green dot + "Connected" label.
- [ ] Play button appears on hover for any track row.
- [ ] Clicking play resolves the file from USB and begins playback.
- [ ] NowPlaying bar appears at bottom right (desktop) or bottom of screen (mobile).
- [ ] Track title and artist displayed in NowPlaying bar.
- [ ] Seek slider moves in sync with playback.
- [ ] Waveform in the active track row shows animated playhead moving left to right.
- [ ] Played region (left of playhead) is visually dimmed.
- [ ] Unplayed region (right of playhead) is at full brightness.
- [ ] Click on active waveform at 50% → audio seeks to halfway point.
- [ ] Track Detail waveform also shows playhead if same track is open.

---

## 7. USB disconnected during playback

**Setup:** Track playing from USB.

- [ ] Physically unplug USB drive.
- [ ] Within ~1 s of focus change, playback stops and NowPlaying bar shows error state.
- [ ] Error message references USB disconnection or permission.
- [ ] "Connect USB" button shown in error bar.
- [ ] No audio data cached locally (plugging USB back in is required to replay).
- [ ] Object URL is revoked (no memory leak).

---

## 8. Permission revoked between sessions

**Setup:** Grant USB permission in one browser session, close and reopen browser.

- [ ] On reload, sidebar shows USB status as "Permission Required" (amber dot).
- [ ] Clicking "Re-authorize" triggers browser permission dialog.
- [ ] After granting, status changes to "Connected" (green dot).
- [ ] Play button works normally after re-authorization.

---

## 9. Wrong USB folder selected

**Setup:** Click "Connect USB" and select a non-Rekordbox directory (e.g. Downloads).

- [ ] USB status shows "Connected" initially.
- [ ] Structure warning badge appears in expanded USB button.
- [ ] Attempting to play a track shows "Track file not found" error.
- [ ] No crash or unhandled exception.

---

## 10. Missing track file (track in DB but not on USB)

**Setup:** A track that exists in Rekordbox DB but whose audio file was deleted or is on a different drive.

- [ ] Play button appears (USB is connected).
- [ ] Clicking play shows error: "Track file not found at …".
- [ ] NowPlaying bar shows error with the path that could not be resolved.
- [ ] Other tracks on the same USB can still be played.

---

## 11. Audio track switch

**Setup:** Track A playing, click play on Track B.

- [ ] Track A stops immediately.
- [ ] Track B begins loading (Loader2 spinner in play button column).
- [ ] NowPlaying bar updates to show Track B.
- [ ] Waveform progress in Track A row resets to zero (no leftover playhead).
- [ ] Waveform in Track B row begins animating from left.
- [ ] Object URL from Track A is revoked before Track B URL is created.

---

## 12. Browser refresh during playback

**Setup:** Track playing.

- [ ] Refresh the page.
- [ ] After reload, NowPlaying bar is gone (no stale player state).
- [ ] USB connection status restores from IndexedDB (may show "Permission Required").
- [ ] Audio element is garbage-collected (no audio playing after refresh).
- [ ] Object URL from pre-refresh session is not accessible (revoked by browser on unload).

---

## 13. Theme switching (Dark / Light / CDJ)

**Setup:** Tracks tab open with waveforms visible.

- [ ] Toggle Dark → Light → CDJ from Settings → Theme.
- [ ] The selection persists after a reload and unsupported stored values fall back to Dark.
- [ ] CDJ applies throughout authentication, library, detail, discovery, Drop Lab, modals, and transport surfaces.
- [ ] CDJ removes ambient blobs/glass blur, tightens panel radii, and uses blue interaction states while the DropDex logo remains coral/peach.
- [ ] Monochrome waveforms switch to the Rekordbox appearance and redraw in blue/cyan under CDJ.
- [ ] Color (RGB) waveforms do **not** change color.
- [ ] Switching back to Dark or Light restores the original DropDex waveform appearance.
- [ ] CDJ uses a bright white playhead and visibly dims the unplayed waveform region.
- [ ] No visual artifacts or flickering.

---

## 14. Mobile layout

**Setup:** Narrow viewport (< 640 px) or mobile device.

- [ ] NowPlaying bar shows at bottom of screen, above mobile nav.
- [ ] Mobile nav shifts up by 64 px when player is active.
- [ ] Track rows use mobile layout (play button + title/artist, waveform below).
- [ ] Play button visible and tappable.
- [ ] Waveform click-to-seek works on mobile (touch events).
- [ ] USB button accessible in mobile sidebar or settings.

---

## 15. Accessibility

- [ ] Tab through the Tracks tab: each row is focused with visible ring.
- [ ] Press Enter on a focused track row → track detail opens.
- [ ] Tab to play button within row → Enter starts playback.
- [ ] NowPlaying bar: all buttons reachable by keyboard.
- [ ] Seek slider responds to left/right arrow keys.
- [ ] Screen reader announces NowPlaying bar as "Now Playing" region.
- [ ] Waveform canvas is `aria-hidden`; surrounding `div` has `role="img"` and `aria-label`.
- [ ] Error states are communicated via text, not color alone.

---

## 16. Large library performance (200+ tracks)

**Setup:** Import with 500+ tracks, open Tracks tab.

- [ ] Initial render smooth — no jank.
- [ ] Waveforms load incrementally (skeleton → waveform), not all at once.
- [ ] Scroll with active track playing: no dropped frames, waveform animates only in the visible active row.
- [ ] Other rows do not re-render during playback (check with React DevTools profiler).
- [ ] Memory does not grow unbounded while scrolling.
- [ ] "Load 200 more" button functions correctly.

---

## 17. Unsupported browser (Firefox, Safari)

**Setup:** Open DropDex in Firefox or Safari.

- [ ] USB button shows "USB Not Supported" state.
- [ ] Play buttons show USB icon (not play icon).
- [ ] Tooltip text explains USB audio is unavailable in this browser.
- [ ] All non-USB features (library browsing, search, track detail, discovery) function normally.
- [ ] No unhandled errors in console.
