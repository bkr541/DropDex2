# Roulette Stage 7 — Hardening and Production Validation Report

## 1. Implementation / hardening summary

Stage 7 audited the existing Stage 1–6 Roulette architecture rather than introducing a replacement path. The production defect found and fixed was at the final desktop separation boundary: preview work was serialized with preview work, and the renderer HQ service serialized HQ work with itself, but the Electron `StemSeparationBridge` did not enforce one global separator slot across **both** preview and HQ requests. Two independent HQ IPC requests could also overlap.

`StemSeparationBridge` now owns one canonical separation queue for preview and HQ jobs. Queued work is cancellable before launch, active cancellation terminates the worker, job maps are cleaned when work settles, and the next request cannot start until the current worker has fully settled. Renderer queues remain useful for UX ordering but are no longer relied on as the resource-safety authority.

Stage 7 also demoted two source-string “production path” tests to explicitly named **static wiring checks**. Runtime acceptance is not inferred from string presence.

A Stage 7 real-audio integration harness was added. It generates a legal/local WAV, sends a real 1-second preview window through the production ffmpeg extraction path, substitutes only the unavailable Demucs inference step, then runs the production WAV validation, ffmpeg-derived metrics, pair publication, and cleanup path. A companion test runs the actual Demucs boundary automatically when a valid runtime/model is provisioned and skips truthfully otherwise.

## 2. Final end-to-end production path

1. `RouletteView` consumes the app-wide `RouletteSessionProvider`.
2. `createRouletteActionExecutor` owns initialize / Change Vocal / Change Instrumental / Roulette Both command semantics.
3. `createRouletteMatchingEngine` obtains candidates from the candidate index/query layer and applies the canonical matcher in `rouletteMatching.ts`.
4. Canonical compatibility remains Camelot exact/approved branches, direct ±5 BPM, usable beat grid, fixed tempo, different parent tracks, and fixed 16-bar audition windows.
5. `roulettePreviewPreparationService` checks for reusable HQ truth first, otherwise prepares only the selected preview source/window.
6. Electron IPC resolves the current USB/source path. Missing or wrong source media returns structured recovery states instead of fake readiness.
7. `StemSeparationBridge` now puts **every preview and HQ Demucs request into the same one-at-a-time desktop queue**.
8. `stem_separator.py` extracts the requested preview window when applicable, invokes the separator, validates a complete audio pair, computes real decoded-audio metrics, and only then allows publication.
9. Managed preview assets and generated HQ assets use separate storage roots/identity contracts.
10. `rouletteAudioRuntime` resolves locally truthful media, decodes through the shared audio loader, applies the existing pitch-locked time-stretch/alignment path, and schedules both decks against one Web Audio clock.
11. Replacement actions preserve the locked-side invariant and prepare only the newly selected side.
12. Explicit HQ preparation uses `rouletteStemPreparationService` / `rouletteHqPairController`; successful per-track outputs remain reusable and are preferred by later preview resolution.
13. Because `RouletteSessionProvider` is mounted above view navigation in `App.tsx`, navigating away/back does not create a second Roulette runtime owner.

## 3. Canonical owners

| Concern | Canonical owner |
| --- | --- |
| Candidate compatibility and scoring | `src/features/roulette/rouletteMatching.ts` |
| Candidate orchestration | `src/features/roulette/rouletteMatchingEngine.ts` + `rouletteCandidateIndex.ts` |
| Preview queue / USB recovery / preview state | `src/features/roulette/roulettePreviewPreparationService.ts` |
| Desktop-wide separator concurrency | `electron/stemSeparationBridge.cjs` |
| HQ preparation lifecycle | `src/features/roulette/stemPreparationService.ts` + `rouletteHqPairController.ts` |
| Managed asset local truth | `src/features/roulette/stemAssetService.ts` + `electron/stemAssetStorage.cjs` |
| Session / replacement invariants | `src/features/roulette/rouletteActions.ts` + `rouletteSession.ts` |
| Decode, alignment, WSOLA and playback graph | `src/features/roulette/rouletteAudioRuntime.ts` + shared audio modules |
| App-level Roulette lifetime | `src/features/roulette/RouletteSessionContext.tsx` |
| Runtime/model health | `electron/stemSeparationBridge.cjs` + `bridge/rekordbox_bridge/stem_separator.py` |

## 4. Stale / duplicate path audit

- **Fixed:** separate desktop serialization domains could allow preview + HQ or independent HQ workers to overlap. Replaced by one bridge-owned `separationQueue` / `separationActive` domain.
- **Demoted:** `roulettePreviewProductionPath.test.ts` and `rouletteStemPreparationProductionPath.test.ts` were source-string tests whose names implied runtime production proof. They are now `roulettePreviewStaticWiring.test.ts` and `rouletteStemPreparationStaticWiring.test.ts`, explicitly labeled non-runtime acceptance.
- **No production bypass found:** no alternate Roulette ±2 BPM matcher was found on the reachable Roulette path. Other ±2 logic belongs to unrelated features.
- **No second stem architecture introduced:** existing preview/HQ preparation, IPC, storage, Python separator, asset service, Web Audio, and WSOLA paths remain authoritative.
- **No batch-on-open path found:** Roulette initial load selects/prepares the chosen pair; it does not enumerate the library into separation work.

## 5. Files changed and why

- `electron/stemSeparationBridge.cjs` — enforce one global preview/HQ separator slot and consistent queued/active cancellation cleanup.
- `electron/stemSeparationBridge.test.cjs` — add mixed HQ/preview serialization and queued-HQ cancellation tests.
- `bridge/tests/test_roulette_stage7_real_audio.py` — add generated real-audio production-boundary harness plus truthfully skipped full-Demucs harness.
- `src/features/roulette/roulettePreviewStaticWiring.test.ts` — renamed/demoted static source-string wiring check and updated it to the canonical shared queue.
- `src/features/roulette/rouletteStemPreparationStaticWiring.test.ts` — renamed/demoted static source-string wiring check.
- `docs/roulette-stage7-production-validation.md` — this exact validation record.

## 6. Database / migration / persistence changes

None. The Stage 7 defect was a runtime concurrency ownership issue, not a schema defect. Existing preview-vs-HQ identity, installation-aware local truth, durable HQ asset records, and migration/default behavior were retained.

## 7. Tests added / changed / removed

Added:
- global HQ + preview desktop serialization test;
- queued HQ cancellation-before-launch test;
- generated real-audio preview extraction/separation-boundary test;
- full Demucs integration harness that runs only when the actual runtime/model is present.

Changed:
- two source-string tests are explicitly static wiring checks and are not treated as runtime acceptance evidence.

Removed:
- no behavioral test coverage was removed.

## 8. Commands run and exact results

### Passed

- `node --test electron/*.test.cjs` → **43 passed, 0 failed, 0 skipped**.
- `PYTHONPATH=bridge python3 -m pytest -q bridge/tests/test_roulette_stage7_real_audio.py` → **1 passed, 1 skipped**. The skipped case is the full Demucs harness because the model is not provisioned.
- Earlier targeted stem/audio validation (`test_stem_separator.py` + `test_stem_audio_metrics.py`) → **9 passed**.
- `node -c electron/stemSeparationBridge.cjs` → passed.
- `node -c electron/stemSeparationBridge.test.cjs` → passed.
- `git diff --check` → passed.

### Full Python regression run

`PYTHONPATH=bridge python3 -m pytest -q bridge/tests` → **225 passed, 1 skipped, 1 failed**.

The single failure is unrelated to Roulette Stage 7: `bridge/tests/test_stage5_prerequisites.py::test_imported_cues_remain_immutable_and_stage7_uses_saved_drafts_only` expects the literal source string `resolveCueApplySelection(rows, scope)` in `CuePointsView.tsx`. Neither that test nor `CuePointsView.tsx` was modified by this work. The failure is therefore recorded, not silently “fixed” outside Stage 7 scope.

### Runtime/model verification

`npm run verify:roulette-runtime` → failed because `bridge/.roulette-runtime-venv/bin/python` is absent in this repository/environment. Direct Python runtime health identifies the substantive runtime limitation as **`model_missing`** for `htdemucs` weights.

### TypeScript / Vitest limitation in this execution environment

The repository arrived without `node_modules`. A clean `npm ci` was attempted, but registry access did not progress in the execution sandbox and was stopped without modifying project files. Consequently:

- `npm run typecheck` → cannot resolve `vite/client` type definitions because dependencies are not installed.
- `npm test` → `vitest: not found` because dependencies are not installed.

This is reported as **unexecuted validation**, not as passing coverage. Existing TypeScript/Vitest Roulette tests were audited but could not be re-run here.

## 9. Falsification attempts and results

| Scenario | Stage 7 result |
| --- | --- |
| Preview + HQ requested concurrently | **Executed / passed** — max active separator workers = 1 |
| Multiple HQ requests through desktop bridge | **Executed / passed** — shared queue serializes them |
| Cancel queued HQ | **Executed / passed** — never launches worker |
| Cancel queued preview | **Executed / passed** in existing Electron suite — never launches/publishes |
| Active separation cancellation | **Executed / passed** in existing Electron suite — worker terminated, no ready result |
| Preview cache reuse / changed window invalidation | **Executed / passed** in existing Electron suite |
| Real preview audio window extraction | **Executed / passed** with generated WAV and real ffmpeg |
| Output is actual decodable audio, not text | **Executed / passed** (`RIFF` WAV + production metadata/metrics validation) |
| Full actual Demucs inference | **Not executable here** — harness skipped because htdemucs weights are absent |
| Wrong/missing USB and reconnect/resume | Existing runtime tests/code audited; **Vitest re-run unavailable** due missing JS dependencies |
| ±5 BPM / Camelot wraparound / missing grid / variable tempo | Canonical matcher and existing tests audited; **Vitest re-run unavailable** |
| Rapid replacement commands / stale completion | Existing action/session tests audited; **Vitest re-run unavailable** |
| Play → Stop → Play / decode cancellation / stale scheduling | Existing audio-runtime tests audited; **Vitest re-run unavailable** |
| One valid pair / no valid pair | Existing matcher/action coverage audited; **Vitest re-run unavailable** |
| Persistent HQ preferred after re-entry | Persistence/resolution path audited; **desktop restart was not launched in this environment** |
| Stale local-ready DB record with missing file | Local-truth implementation/tests audited; **Vitest re-run unavailable** |

## 10. Real-audio validation performed

The Stage 7 generated fixture is stereo PCM WAV, created locally during the test. The production `extract_audio_window` implementation uses ffmpeg to create the requested one-second clip. Only Demucs model inference is substituted; the rest of the actual separator contract executes:

- source file resolution;
- real ffmpeg preview-window extraction;
- expected Demucs output discovery;
- complete pair publication staging;
- real WAV header/frame/sample-rate/channel validation;
- real ffmpeg-derived signal/activity metrics;
- exact requested-duration validation;
- cleanup of temporary preview source and Demucs work tree.

The generated published assets are verified as `RIFF` WAVs and successfully re-probed through the production audio inspection path.

The real Roulette Web Audio/WSOLA module has executable Vitest coverage in the repository, including shared-clock scheduling, preview offset-zero behavior, decode cancellation, stop cleanup, pitch-locked preparation cancellation, and variable-tempo refusal. Those tests could not be executed here because the repository's JS dependencies are absent and registry installation was unavailable.

## 11. Items that could not be executed or verified here

- actual `htdemucs` inference, because model weights are not provisioned;
- packaged Roulette runtime verification, because the repository-local runtime venv is absent;
- Vitest/TypeScript suite, because `node_modules` is absent and dependency installation could not complete in this sandbox;
- interactive Electron UI clicking / real USB hot-unplug in a packaged desktop session;
- full application restart against a real persisted user database and managed HQ stem directory.

No success is claimed for these items.

## 12. Remaining MVP limitations

Only environment/runtime limitations remain from this Stage 7 validation pass:

- a production install must provision and verify the supported local Demucs runtime/model before real stem separation can execute;
- the project dependency set must be installed in the normal development/CI environment to run the TypeScript/Vitest acceptance suite;
- the one unrelated cue-point static regression assertion should be reconciled by its owning feature separately, rather than folded into Roulette hardening.

No new variable-tempo support, alternate bar lengths, model installer, separator library, automatic vocal-quality rejection, visual redesign, or unrelated refactor was added.
