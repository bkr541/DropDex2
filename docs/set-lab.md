# Set Lab

Open **Set Lab** from the sidebar with a signed-in account and an active Rekordbox import. The page restores that import’s working draft. Use **Generate Set** to start from an empty draft. The default pool is the full active import. **Generation filters** narrow that pool, and **Apply filters** keeps those settings for later without generating a set. The listing’s search and genre are browsing controls. **Similar Only** is a saved preference for the selected slot’s replacement list.

## Arrange and audition

- Play auditions the five sections in slot order at their original speed and pitch. Each segment has its own Rekordbox beat ruler and its width follows its duration in seconds.
- Select a slot to make it the swap target. Use **Swap** on a track row or **Reroll** in the slot. Swap keeps the bar count and tries to match the selected phrase and occurrence.
- Lock a slot to keep its track and section through full regeneration. A deliberate swap or reposition can still edit a locked slot.
- Set each slot to 4, 8 or 16 bars. Open **Reposition Track** from the selected slot’s button or context menu. Drag the waveform, scroll horizontally, or use the start-downbeat slider. **Save** applies the proposed window. **Cancel** leaves it as it was.
- Applying a swap, reposition, or bar-length change during playback requires confirmation. Cancel keeps playback running. Confirm stops and resets to the start. Use **Undo swap** or **Undo reposition** for the most recent eligible edit.

## Drafts and saved sets

Set Lab autosaves one working draft per account and import. Edits are journaled on this device before the debounced server write. Navigation, hiding the page, and closing it trigger a best-effort flush. On return, Set Lab reads the server revision before replaying pending edits. If server and local drafts conflict, choose **Recover local draft** to replace the server version or **Keep server draft** to discard the local pending changes. **Retry draft save** retries recoverable errors. Reopening requires a server read, so an offline or failed restore retains local pending data until the connection returns.

**Save Set** creates an independent named snapshot. **Saved Sets → Load Set** checks all five tracks, exact grid windows, and authorized sources before offering to replace the working draft with an editable copy. The saved snapshot stays intact. Saved sets are listed across imports and survive deletion of their original import. Set Lab can remap stable identities to the active import. A content-ID match alone is insufficient across imports. New saves keep recording evidence, and older saves can use the original source record when it is still available. Missing, ambiguous, mismatched, or unplayable slots block loading the copy and identify what needs attention.

## Operational limits

Generation and playback require five unique tracks with exact Rekordbox grids and verified audio from the connected local/USB root or the account’s synced DropDex Cloud preview. An estimated grid, incomplete final bar, missing waveform analysis, or unavailable preview has an explicit state. Reconnect the source or select an import with complete analysis and retry. A conflicting PSSI phrase code leaves the section unclassified. The Set Lab adapter leaves importer and Auto Cue interpretation unchanged.

Playback prepares selected ranges one source at a time. The current limits are 96 MiB encoded per source, eight minutes per source, 192 MiB decoded per source, mono/stereo audio, and 80 MiB retained for the five sections. Use shorter sections if the set exceeds its retained memory budget.

## Release checks

- Review and apply `supabase/migrations/20261107010000_set_lab_sessions.sql` through the usual Supabase migration process before enabling the route in an environment that lacks it. It creates `set_lab_sessions`, owner-only reads and the revision-checked `write_set_lab_session_v1` RPC. Phase 08 adds optional fields to the existing version 1 JSON document and needs no separate migration.
- In a migrated test environment, confirm separate accounts cannot see each other’s drafts or saved sets. Verify a named set survives removal of its original import and can reopen against a matching import.
- With real USB and Cloud media, listen across all four transitions, disconnect or revoke a source, and verify the specific failure and recovery. Confirm the same Rekordbox media and analysis remain intact in Drop Lab, Cue Points and Audition.
