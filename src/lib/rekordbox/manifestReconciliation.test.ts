import { describe, it, expect } from 'vitest';
import { buildManifestReconciliation } from './manifestReconciliation';
import type { ManifestEntry } from '../api/rekordboxImport';
import type { MatchedAnalysisFile } from './analysisPaths';

function makeEntry(
  trackId: string,
  datPath: string | null,
  extPath: string | null = null,
  twoExPath: string | null = null,
  datRequired = true,
  rekordboxContentId = `rcid-${trackId}`,
): ManifestEntry {
  return {
    track_id: trackId,
    rekordbox_content_id: rekordboxContentId,
    dat_path: datPath,
    ext_path: extPath,
    two_ex_path: twoExPath,
    dat_required: datRequired,
  };
}

function makeMatched(canonicalPath: string): MatchedAnalysisFile {
  const upper = canonicalPath.toUpperCase();
  const assetType = upper.endsWith('.DAT') ? 'DAT' : upper.endsWith('.EXT') ? 'EXT' : '2EX';
  return {
    file: new File([new Uint8Array(100)], canonicalPath),
    canonicalPath,
    originalBrowserPath: canonicalPath,
    assetType,
    trackId: 'placeholder',
  };
}

// ── Basic structure ───────────────────────────────────────────────────────────

describe('buildManifestReconciliation – basic', () => {
  it('returns zeros for an empty manifest', () => {
    const r = buildManifestReconciliation([], [], new Set());
    expect(r.expectedFiles).toBe(0);
    expect(r.matchedFiles).toBe(0);
    expect(r.successfullyUploadedFiles).toBe(0);
    expect(r.failedFiles).toBe(0);
    expect(r.missingFiles).toBe(0);
    expect(r.requiredMissingFiles).toHaveLength(0);
    expect(r.optionalMissingFiles).toHaveLength(0);
    expect(r.affectedTrackIds).toHaveLength(0);
  });

  it('null paths in manifest entries are not counted as expected', () => {
    const manifest = [makeEntry('t1', 'P001/ANLZ0000.DAT', null, null)];
    const matched = [makeMatched('P001/ANLZ0000.DAT')];
    const uploaded = new Set(['p001/anlz0000.dat']);
    const r = buildManifestReconciliation(manifest, matched, uploaded);
    expect(r.expectedFiles).toBe(1); // only DAT
    expect(r.successfullyUploadedFiles).toBe(1);
    expect(r.filesByType.EXT.expected).toBe(0);
    expect(r.filesByType['2EX'].expected).toBe(0);
  });
});

// ── Scenario 1: All files present and uploaded ────────────────────────────────

describe('Scenario 1 – all files successful', () => {
  it('all DAT + EXT + 2EX uploaded → zero missing or failed', () => {
    const dat = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    const ext = 'PIONEER/USBANLZ/P001/ANLZ0000.EXT';
    const twoEx = 'PIONEER/USBANLZ/P001/ANLZ0000.2EX';
    const manifest = [makeEntry('t1', dat, ext, twoEx)];
    const matched = [makeMatched(dat), makeMatched(ext), makeMatched(twoEx)];
    const uploaded = new Set([dat, ext, twoEx].map((p) => p.toLowerCase()));

    const r = buildManifestReconciliation(manifest, matched, uploaded);

    expect(r.expectedFiles).toBe(3);
    expect(r.matchedFiles).toBe(3);
    expect(r.successfullyUploadedFiles).toBe(3);
    expect(r.failedFiles).toBe(0);
    expect(r.missingFiles).toBe(0);
    expect(r.requiredMissingFiles).toHaveLength(0);
    expect(r.optionalMissingFiles).toHaveLength(0);
    expect(r.affectedTrackIds).toHaveLength(0);
  });
});

// ── Scenario 2: DAT missing from disk (not_found_on_disk) ────────────────────

describe('Scenario 2 – required DAT not found on USB', () => {
  it('absent DAT → requiredMissingFiles with reason not_found_on_disk', () => {
    const dat = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    const manifest = [makeEntry('t1', dat)];
    const matched: MatchedAnalysisFile[] = [];
    const uploaded = new Set<string>();

    const r = buildManifestReconciliation(manifest, matched, uploaded);

    expect(r.expectedFiles).toBe(1);
    expect(r.matchedFiles).toBe(0);
    expect(r.successfullyUploadedFiles).toBe(0);
    expect(r.failedFiles).toBe(0);
    expect(r.missingFiles).toBe(1);
    expect(r.requiredMissingFiles).toHaveLength(1);
    expect(r.requiredMissingFiles[0].reason).toBe('not_found_on_disk');
    expect(r.requiredMissingFiles[0].assetType).toBe('DAT');
    expect(r.requiredMissingFiles[0].required).toBe(true);
    expect(r.requiredMissingFiles[0].trackId).toBe('t1');
    expect(r.affectedTrackIds).toContain('t1');
    expect(r.filesByType.DAT.missing).toBe(1);
    expect(r.filesByType.DAT.uploaded).toBe(0);
  });
});

// ── Scenario 3: DAT found on disk but upload failed ──────────────────────────

describe('Scenario 3 – DAT upload failed after retries', () => {
  it('on-disk DAT not in uploadedPaths → failedFiles, requiredMissingFiles with upload_failed', () => {
    const dat = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    const manifest = [makeEntry('t1', dat)];
    const matched = [makeMatched(dat)];
    const uploaded = new Set<string>(); // never made it

    const r = buildManifestReconciliation(manifest, matched, uploaded);

    expect(r.matchedFiles).toBe(1);
    expect(r.failedFiles).toBe(1);
    expect(r.missingFiles).toBe(0);
    expect(r.requiredMissingFiles).toHaveLength(1);
    expect(r.requiredMissingFiles[0].reason).toBe('upload_failed');
    expect(r.requiredMissingFiles[0].assetType).toBe('DAT');
    expect(r.affectedTrackIds).toContain('t1');
    expect(r.filesByType.DAT.failed).toBe(1);
    expect(r.filesByType.DAT.missing).toBe(0);
  });
});

// ── Scenario 4: Optional EXT/2EX missing from disk ───────────────────────────

describe('Scenario 4 – optional EXT and 2EX not on USB', () => {
  it('DAT uploaded; EXT and 2EX absent → optionalMissingFiles, no affectedTrackIds', () => {
    const dat = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    const ext = 'PIONEER/USBANLZ/P001/ANLZ0000.EXT';
    const twoEx = 'PIONEER/USBANLZ/P001/ANLZ0000.2EX';
    const manifest = [makeEntry('t1', dat, ext, twoEx)];
    const matched = [makeMatched(dat)];
    const uploaded = new Set([dat.toLowerCase()]);

    const r = buildManifestReconciliation(manifest, matched, uploaded);

    expect(r.successfullyUploadedFiles).toBe(1);
    expect(r.missingFiles).toBe(2);
    expect(r.requiredMissingFiles).toHaveLength(0);
    expect(r.optionalMissingFiles).toHaveLength(2);
    expect(r.optionalMissingFiles.every((f) => !f.required)).toBe(true);
    // Optional missing files do not make a track "affected" for required purposes.
    expect(r.affectedTrackIds).toHaveLength(0);
    expect(r.filesByType.EXT.missing).toBe(1);
    expect(r.filesByType['2EX'].missing).toBe(1);
  });
});

// ── Scenario 5: DAT not_required ─────────────────────────────────────────────

describe('Scenario 5 – dat_required = false', () => {
  it('DAT missing from disk but dat_required=false → goes to optionalMissingFiles', () => {
    const dat = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    const manifest = [makeEntry('t1', dat, null, null, false)];
    const matched: MatchedAnalysisFile[] = [];
    const uploaded = new Set<string>();

    const r = buildManifestReconciliation(manifest, matched, uploaded);

    expect(r.requiredMissingFiles).toHaveLength(0);
    expect(r.optionalMissingFiles).toHaveLength(1);
    expect(r.optionalMissingFiles[0].required).toBe(false);
    // Not in affectedTrackIds since it's not required.
    expect(r.affectedTrackIds).toHaveLength(0);
  });
});

// ── Scenario 6: Multiple tracks, mixed results ────────────────────────────────

describe('Scenario 6 – multiple tracks with mixed outcomes', () => {
  it('correctly partitions uploaded, failed, and missing across tracks', () => {
    const manifest = [
      makeEntry('t1', 'A/ANLZ0001.DAT', 'A/ANLZ0001.EXT'),  // all uploaded
      makeEntry('t2', 'B/ANLZ0002.DAT'),                      // DAT missing from disk
      makeEntry('t3', 'C/ANLZ0003.DAT', 'C/ANLZ0003.EXT'),  // DAT uploaded, EXT failed
    ];
    const matched = [
      makeMatched('A/ANLZ0001.DAT'),
      makeMatched('A/ANLZ0001.EXT'),
      makeMatched('C/ANLZ0003.DAT'),
      makeMatched('C/ANLZ0003.EXT'), // found on disk but upload failed
    ];
    const uploaded = new Set([
      'a/anlz0001.dat',
      'a/anlz0001.ext',
      'c/anlz0003.dat',
      // c/anlz0003.ext missing from uploaded (failed)
    ]);

    const r = buildManifestReconciliation(manifest, matched, uploaded);

    expect(r.expectedFiles).toBe(5); // 3 DATs + 2 EXTs
    expect(r.successfullyUploadedFiles).toBe(3); // t1 DAT+EXT, t3 DAT
    expect(r.failedFiles).toBe(1); // t3 EXT
    expect(r.missingFiles).toBe(1); // t2 DAT

    expect(r.requiredMissingFiles).toHaveLength(1); // t2 DAT
    expect(r.requiredMissingFiles[0].trackId).toBe('t2');
    expect(r.requiredMissingFiles[0].reason).toBe('not_found_on_disk');

    expect(r.optionalMissingFiles).toHaveLength(1); // t3 EXT
    expect(r.optionalMissingFiles[0].trackId).toBe('t3');
    expect(r.optionalMissingFiles[0].reason).toBe('upload_failed');

    expect(r.affectedTrackIds).toContain('t2');
    expect(r.affectedTrackIds).not.toContain('t3'); // EXT failure is optional
    expect(r.affectedTrackIds).toHaveLength(1);
  });
});

// ── Scenario 7: All tracks missing DAT ───────────────────────────────────────

describe('Scenario 7 – all tracks missing required DAT (total failure)', () => {
  it('every track DAT absent → all in requiredMissingFiles, matchedFiles=0', () => {
    const manifest = [
      makeEntry('t1', 'P001/ANLZ0000.DAT'),
      makeEntry('t2', 'P002/ANLZ0000.DAT'),
    ];

    const r = buildManifestReconciliation(manifest, [], new Set());

    expect(r.expectedFiles).toBe(2);
    expect(r.matchedFiles).toBe(0);
    expect(r.successfullyUploadedFiles).toBe(0);
    expect(r.missingFiles).toBe(2);
    expect(r.requiredMissingFiles).toHaveLength(2);
    expect(r.affectedTrackIds).toHaveLength(2);
    expect(r.affectedTrackIds).toContain('t1');
    expect(r.affectedTrackIds).toContain('t2');
  });
});

// ── Scenario 8: filesByType aggregates ───────────────────────────────────────

describe('Scenario 8 – filesByType per-type counts', () => {
  it('correctly tallies expected/uploaded/failed/missing per asset type', () => {
    const manifest = [
      makeEntry('t1', 'P001/DAT1.DAT', 'P001/EXT1.EXT', 'P001/2EX1.2EX'),
      makeEntry('t2', 'P002/DAT2.DAT', 'P002/EXT2.EXT', null),
    ];
    const matched = [
      makeMatched('P001/DAT1.DAT'),
      makeMatched('P001/EXT1.EXT'),
      // P001/2EX1.2EX not found on disk
      makeMatched('P002/DAT2.DAT'),
      makeMatched('P002/EXT2.EXT'), // on disk but upload failed
    ];
    const uploaded = new Set([
      'p001/dat1.dat',
      'p001/ext1.ext',
      'p002/dat2.dat',
      // p002/ext2.ext: found, not uploaded
    ]);

    const r = buildManifestReconciliation(manifest, matched, uploaded);

    expect(r.filesByType.DAT).toEqual({ expected: 2, uploaded: 2, failed: 0, missing: 0 });
    expect(r.filesByType.EXT).toEqual({ expected: 2, uploaded: 1, failed: 1, missing: 0 });
    expect(r.filesByType['2EX']).toEqual({ expected: 1, uploaded: 0, failed: 0, missing: 1 });
  });
});

// ── Scenario 9: path case-insensitive matching ────────────────────────────────

describe('Scenario 9 – case-insensitive path matching', () => {
  it('uploadedPaths uses lowercase; manifest paths are lowercased for lookup', () => {
    const manifest = [makeEntry('t1', 'PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    const matched = [makeMatched('PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    // uploadedPaths already lowercase (from UploadAccumulator.successfullyUploadedPaths)
    const uploaded = new Set(['pioneer/usbanlz/p001/anlz0000.dat']);

    const r = buildManifestReconciliation(manifest, matched, uploaded);

    expect(r.successfullyUploadedFiles).toBe(1);
    expect(r.failedFiles).toBe(0);
    expect(r.missingFiles).toBe(0);
  });

  it('matchedFiles paths lowercased when building matchedPathSet', () => {
    const manifest = [makeEntry('t1', 'PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    // matchedFiles uses original browser casing
    const matched = [makeMatched('PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    const uploaded = new Set<string>(); // not uploaded — but IS on disk

    const r = buildManifestReconciliation(manifest, matched, uploaded);

    // Should be classified as "failed" (on disk, not uploaded), not "missing"
    expect(r.failedFiles).toBe(1);
    expect(r.missingFiles).toBe(0);
  });
});
