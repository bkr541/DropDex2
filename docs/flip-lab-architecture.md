# Flip Lab Architecture

Flip Lab is DropDex's two-source audition workspace for testing a qualifying vocal role from one parent track over an instrumental role from another parent track. It is intentionally an audition/mashup surface, not a second matching engine and not a continuation of Drop Lab.

## Candidate sources and vocal qualification

Flip Lab loads candidates through `fetchRouletteCandidatePools()` from `src/lib/queries/rouletteCandidates.ts`. This is the same candidate boundary used by Roulette. The Vocal pool must satisfy Roulette's qualifying vocal-analysis contract (valid, complete vocal analysis with usable vocal material). The Instrumental pool is the broader eligible track pool and is not filtered by vocal qualification.

Flip Lab must not recreate or weaken these rules locally. If the Roulette candidate contract changes, Flip Lab should consume the updated shared contract.

## Canonical compatibility ownership

`src/components/flip-lab/flipLabMatching.ts` is a thin adapter over Roulette matching:

- `chooseInitialFlipLabPair()` uses canonical bounded pair ranking.
- `rankFlipLabSuggestions()` uses canonical candidate ranking for the opposite role.
- `getFlipLabPairRejectionReason()` delegates to Roulette's hard-filter reason.
- the same parent track cannot occupy both roles.

The **Pair Ready** state in the UI means the currently selected pair passes canonical matching hard filters and both prepared role media are locally usable. Pair Ready is Flip Lab status only; it is not navigation.

## Stem preparation and local truth

`flipLabStemLifecycle.ts` owns selected-role preparation state. Selection invokes the shared Roulette preview preparation service and distinguishes checking, queued/processing, ready, unavailable, and error states. A stem is usable only when the lifecycle state, selected parent identity, prepared asset, and prepared window agree.

Clearing a role calls the shared audio stop path, stops candidate preview audio, clears the selected ID, and selects `null` in the stem lifecycle. The other role remains selected. Flip Lab does not immediately auto-fill the cleared side.

## Shared audio runtime

`useFlipLabAudioRuntime.ts` adapts the shared Roulette audio runtime. Playback is built from the actual prepared vocal/instrumental media references and their prepared windows, not from parent-track audio. Both roles share one runtime clock so play/pause, seeking, synchronization, loop bounds, EQ, and the cross-mix remain coherent.

The displayed master BPM is derived from the same Roulette tempo plan used by playback. It is not a hardcoded Flip Lab BPM and is not an independently editable session value. Sync enablement is persisted because that is the user-controlled tempo state.

## Phrase and beat-grid data

Flip Lab loads beat-grid and phrase analysis for the selected parent tracks with `fetchTrackBeatGrid()` and `fetchTrackPhrases()`. `flipLabAnalysis.ts` maps that analysis into phrase bands, bar markers, BPM delta, and alignment state. The UI must not invent phrase positions or fake playheads when analysis or prepared media is unavailable.

## Session persistence

`flipLabSession.ts` persists non-sensitive UI/audio state to local storage under an import-scoped key:

`dropdex:flip-lab-session:v1:<rekordbox-import-id>`

Persisted state includes selected parent track IDs, Vocal/Instrumental tab modes, sync enabled state, mix position, per-role EQ, and loop length. Search text is intentionally transient.

Restore is validated against the freshly loaded role-specific candidate pools. Non-null IDs that no longer exist or are no longer eligible are not resurrected. A persisted same-track or canonically rejected pair falls back to the current canonical initial recommendation. Explicitly cleared roles (`null`) remain cleared. The persistence effect does not write until the active import's state has been hydrated, which prevents import changes from overwriting a previous session with reset values.

## Relationship to Drop Lab

Drop Lab tests transitions between parent tracks/drop points. The current route contract accepts:

- `sourceTrackId`
- `candidateTrackId`
- optional `sourceDropId`
- optional `candidateDropId`

`buildFlipLabDropLabRoute()` therefore passes only the selected Vocal and Instrumental **parent track IDs** and leaves both drop IDs unset. Flip Lab stems, prepared windows, EQ, mix, loop, sync runtime state, and playback position do not carry into Drop Lab.

The UI exposes this as a separate **Test Transition in Drop Lab** action beneath the Flip Lab readiness status so the two concepts cannot be mistaken for one another.

## Regression ownership

The Flip Lab tests are intentionally split by responsibility:

- `rouletteCandidates.test.ts`: vocal qualification and non-vocal-filtered Instrumental pool.
- `flipLabMatching.test.ts`: canonical initial pair, Suggested ranking, same-parent rejection, Pair Ready hard filters.
- `flipLabStemLifecycle.test.ts`: local readiness truth and preparation lifecycle.
- `useFlipLabAudioRuntime.test.ts`: prepared-media playback sources, shared tempo/runtime math, EQ/mix/loop behavior.
- `flipLabAnalysis.test.ts`: phrase/beat-grid derived alignment.
- `flipLabSession.test.ts`: import scoping, persisted controls, restore validation, clear-state preservation.
- `flipLabHandoff.test.ts`: parent-track-only Drop Lab contract.
- `flipLabHardeningStaticWiring.test.ts`: final affordance and wording guardrails that are inherently UI wiring concerns.

When changing shared Roulette internals, run both the Flip Lab suites and the broader Roulette matching/candidate/audio tests.
