# Audio Quality Detection

## Overview

This document captures the research, available data, and implementation plan for a feature that helps DJs identify audio tracks in their library that may need editing or removal before performing at clubs. The three core problem categories are:

- **Glitching artifacts** — random pops, clicks, or corruptions in the audio
- **Undermastered tracks** — recordings with consistently low volume relative to commercial standards
- **Inconsistent loudness** — tracks with sections that are noticeably louder or softer than the rest

---

## Potential Quality Signals to Surface

The following are the quality problems a DJ would want to catch before a live set:

| Problem | What the DJ Hears | Detection Signal |
|---|---|---|
| Random glitching artifacts | Pops, clicks, dropouts mid-track | Sudden amplitude spikes or gaps in waveform data |
| Undermastered / quiet tracks | Track sounds weak compared to others in the mix | Low average waveform amplitude across the full track |
| Over-compressed / brickwalled | No punch or dynamics; fatiguing at volume | Very narrow gap between min and max amplitude (crest factor) |
| Inconsistent section loudness | Verse is quiet, chorus is loud, or vice versa | High variance in per-segment amplitude across the track |
| Too hot / clipping | Distortion, especially in the high end | High percentage of waveform columns near the maximum value |
| Low encoding quality | Lossy artefacts, thin or muffled sound | Low `bitrate_kbps` or low `bit_depth` relative to club standards |

---

## What DropDex Currently Captures

### `rekordbox_tracks` table

These fields exist today and come from the Rekordbox Device Library Plus database during the USB import phase:

| Column | Type | Usefulness for Quality |
|---|---|---|
| `bitrate_kbps` | integer | Low bitrate (e.g. <256 kbps MP3) flags encoding quality issues |
| `bit_depth` | integer | 16-bit is acceptable; 8-bit or missing signals a degraded file |
| `sample_rate_hz` | integer | Below 44100 Hz may indicate a ripped or degraded source |
| `file_size_bytes` | bigint | Anomalously small size relative to duration can flag corrupt files |
| `file_format` | text | MP3 vs. WAV vs. AIFF; clubs typically expect lossless or high-bitrate lossy |
| `analysed_bits` | integer | A Rekordbox task-completion bitmask — indicates whether analysis ran, **not** a signal-level field |
| `duration_seconds` | integer | Used to normalise per-second metrics |

**What is NOT on this table today:** no loudness (LUFS), no RMS, no peak dBFS, no dynamic range score, no clipping flag.

### `rekordbox_track_waveforms` table

These fields are populated after the ANLZ analysis phase:

| Column | Content |
|---|---|
| `preview_column_count` | Number of preview-resolution waveform columns |
| `preview_columns` | JSONB array — each column has `h` (height/amplitude, 0–127 for PWV4), `r`, `g`, `b` (colour channels) |
| `detail_column_count` | Number of detail-resolution columns (much higher density) |
| `detail_storage_bucket` / `detail_storage_path` | Pointer to gzip-compressed JSON in Supabase Storage containing the full detail waveform |

**The `h` field in every column is Rekordbox's internal amplitude proxy.** It is the most actionable signal currently stored. It is not calibrated in dBFS but is consistent within and across tracks of the same format (PWV4 preview: 0–127; PWV5 detail and monochrome: 0–31).

### `roulette_stem_assets` table

| Column | Content |
|---|---|
| `analysis_metrics` | Freeform JSONB — per-stem metrics written during Roulette stem processing. Exists only on separated vocal/instrumental stems, **not** on the source tracks. |

### Gaps — What Is Not Captured Today

- No integrated loudness (LUFS/LKFS) on any track table
- No RMS, peak dBFS, or true-peak values
- No dynamic range score (DR value, crest factor, LRA)
- No clipping or over-level flag
- No waveform-derived statistics (mean height, standard deviation, percentile spread) stored as indexed columns — amplitude data must be re-read from Storage to compute any of these
- PWV6 / PWV7 / PWVC tags (from 2EX files, newer Rekordbox format) are currently skipped by the parser — these may carry higher-resolution amplitude data
- Glitch/artifact detection requires decoded PCM audio (FFT or short-time energy analysis), which is out of scope for the ANLZ-based pipeline

---

## Recommendation and Implementation Plan

### What We Can Build Now

The waveform `h` values already stored in `rekordbox_track_waveforms` are sufficient to compute four useful quality signals without re-importing or touching ANLZ files again:

| Signal | Formula | Flags |
|---|---|---|
| **Perceived loudness proxy** | Mean `h` across all preview columns | Tracks with mean below a threshold (e.g. < 20% of max) are likely undermastered |
| **Dynamic range proxy (crest factor)** | `max(h) / mean(h)` | Very low ratio (< ~1.5) indicates over-compression / brickwalling |
| **Loudness variance** | Standard deviation of `h` across time segments | High std-dev relative to mean flags inconsistent section loudness |
| **Clipping proxy** | Percentage of columns where `h >= 95% of max value` | High percentage suggests the track is too hot or peaking |

These four signals together cover three of the four user-facing problems (all except glitch artifacts).

Additionally, `bitrate_kbps` and `bit_depth` can immediately flag encoding-quality issues with zero additional computation.

### What We Cannot Build Yet (and Why)

| Problem | Blocker |
|---|---|
| Glitching artifact detection | Requires decoded PCM audio — not available in the ANLZ pipeline |
| Calibrated LUFS / dBFS values | Rekordbox `h` values are not in physical units; relative only |
| PWV6/PWV7 data | Parser skips 2EX modern waveform tags; would need importer update |

### Recommended Architecture

**Phase 1 — Encoding quality flags (zero infrastructure cost)**
Immediately usable from existing `rekordbox_tracks` data. Filter or badge tracks where:
- `bitrate_kbps < 256` and `file_format = 'MP3'`
- `bit_depth < 16`
- `sample_rate_hz < 44100`

**Phase 2 — Waveform quality scoring (moderate effort)**

A background scoring job reads `preview_columns` from `rekordbox_track_waveforms` (already in the DB as JSONB — no Storage fetch needed for preview data) and writes derived statistics to a new `audio_quality_score` JSONB column on `rekordbox_tracks`:

```json
{
  "computed_at": "2026-09-27T00:00:00Z",
  "waveform_source": "preview",
  "mean_amplitude": 0.42,
  "amplitude_stddev": 0.18,
  "crest_factor": 1.8,
  "clip_ratio": 0.02,
  "flags": ["low_loudness", "high_variance"]
}
```

The job would run:
- Automatically after every import completes (triggered from the analysis worker's completion path)
- On-demand from the Library UI for individual tracks or the whole library

**Phase 3 — Library UI surfacing**
- Inline quality badge on track rows (e.g. a small amber `⚠` with a tooltip listing the specific flags)
- A dedicated **"Quality Issues"** filter in the library browser alongside the existing Status / Genre / Key filters
- A quality issues tab in the existing Library view (similar to the current "Analysis Incomplete" tab)

### Signal Thresholds (Starting Point)

These are reasonable defaults to start with; they should be tunable per-user:

| Flag | Condition | Meaning |
|---|---|---|
| `low_loudness` | mean_amplitude < 0.25 | Track is likely undermastered |
| `high_variance` | amplitude_stddev / mean_amplitude > 0.6 | Sections are inconsistently loud |
| `low_dynamic_range` | crest_factor < 1.3 | Track is over-compressed / brickwalled |
| `clipping_risk` | clip_ratio > 0.05 | More than 5% of waveform is at or near ceiling |
| `low_bitrate` | bitrate_kbps < 256 and format = MP3 | Encoding quality below club standard |
| `low_bit_depth` | bit_depth < 16 | Below CD quality |

---

## Open Questions Before Implementation

1. Should quality scoring run automatically after every import, or be triggered on-demand from the Library UI?
2. Should thresholds be global defaults or configurable per-user in the Profile / Settings UI?
3. Should the "Quality Issues" surface be a new library tab, an inline badge system, or both?
4. Is glitch/artifact detection (requiring actual audio decoding) worth scoping as a separate, longer-term feature?
