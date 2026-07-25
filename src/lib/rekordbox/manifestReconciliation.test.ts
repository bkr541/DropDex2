import { describe, expect, it } from 'vitest';
import type { ManifestEntry } from '../api/rekordboxImport';
import type { MatchedAnalysisFile } from './analysisPaths';
import { buildManifestReconciliation } from './manifestReconciliation';

function makeEntry(
  trackId: string,
  datPath: string | null,
  extPath: string | null = null,
  twoExPath: string | null = null,
  manifestStatus = 'needs_analysis',
): ManifestEntry {
  return {
    track_id: trackId,
    rekordbox_content_id: `rcid-${trackId}`,
    dat_path: datPath,
    ext_path: extPath,
    two_ex_path: twoExPath,
    dat_required: manifestStatus !== 'reused' && manifestStatus !== 'metadata_only',
    manifest_status: manifestStatus,
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

describe('buildManifestReconciliation', () => {
  it('returns zeros for an empty manifest', () => {
    const result = buildManifestReconciliation([], [], new Set());
    expect(result.expectedFiles).toBe(0);
    expect(result.optionalArchivalFiles).toBe(0);
    expect(result.affectedTrackIds).toEqual([]);
  });

  it('counts DAT and EXT as blocking work while separating optional 2EX', () => {
    const dat = 'PIONEER/USBANLZ/P001/A.DAT';
    const ext = 'PIONEER/USBANLZ/P001/A.EXT';
    const twoEx = 'PIONEER/USBANLZ/P001/A.2EX';
    const result = buildManifestReconciliation(
      [makeEntry('t1', dat, ext, twoEx)],
      [makeMatched(dat), makeMatched(ext), makeMatched(twoEx)],
      new Set([dat.toLowerCase(), ext.toLowerCase(), twoEx.toLowerCase()]),
    );

    expect(result.expectedFiles).toBe(2);
    expect(result.optionalArchivalFiles).toBe(1);
    expect(result.matchedFiles).toBe(2);
    expect(result.successfullyUploadedFiles).toBe(2);
    expect(result.filesByType['2EX']).toEqual({ expected: 1, uploaded: 0, failed: 0, missing: 0 });
    expect(result.requiredMissingFiles).toEqual([]);
  });

  it('marks a required DAT missing on disk as an affected track', () => {
    const dat = 'PIONEER/USBANLZ/P001/A.DAT';
    const result = buildManifestReconciliation([makeEntry('t1', dat)], [], new Set());

    expect(result.missingFiles).toBe(1);
    expect(result.requiredMissingFiles[0]).toMatchObject({
      trackId: 't1',
      assetType: 'DAT',
      required: true,
      reason: 'not_found_on_disk',
    });
    expect(result.affectedTrackIds).toEqual(['t1']);
  });

  it('distinguishes an upload failure from a file missing on disk', () => {
    const dat = 'PIONEER/USBANLZ/P001/A.DAT';
    const result = buildManifestReconciliation(
      [makeEntry('t1', dat)],
      [makeMatched(dat)],
      new Set(),
    );

    expect(result.failedFiles).toBe(1);
    expect(result.missingFiles).toBe(0);
    expect(result.requiredMissingFiles[0].reason).toBe('upload_failed');
  });

  it('treats requested EXT as optional and never treats absent 2EX as a failure', () => {
    const dat = 'PIONEER/USBANLZ/P001/A.DAT';
    const ext = 'PIONEER/USBANLZ/P001/A.EXT';
    const twoEx = 'PIONEER/USBANLZ/P001/A.2EX';
    const result = buildManifestReconciliation(
      [makeEntry('t1', dat, ext, twoEx)],
      [makeMatched(dat)],
      new Set([dat.toLowerCase()]),
    );

    expect(result.missingFiles).toBe(1);
    expect(result.optionalMissingFiles).toHaveLength(1);
    expect(result.optionalMissingFiles[0]).toMatchObject({ assetType: 'EXT', required: false });
    expect(result.filesByType['2EX'].missing).toBe(0);
    expect(result.affectedTrackIds).toEqual([]);
  });

  it('honors reused, metadata-only, retained-reparse, and unavailable statuses', () => {
    const manifest = [
      makeEntry('reused', 'A.DAT', 'A.EXT', 'A.2EX', 'reused'),
      makeEntry('metadata', 'B.DAT', 'B.EXT', 'B.2EX', 'metadata_only'),
      makeEntry('retained', 'C.DAT', 'C.EXT', 'C.2EX', 'reparse_from_retained'),
      makeEntry('unavailable', 'D.DAT', 'D.EXT', 'D.2EX', 'unavailable'),
    ];
    const result = buildManifestReconciliation(manifest, [], new Set());

    expect(result.expectedFiles).toBe(0);
    expect(result.tracksAlreadyReusable).toBe(2);
    expect(result.tracksRequiringAnalysis).toBe(1);
    expect(result.unavailableTracks).toBe(1);
    expect(result.affectedTrackIds).toEqual([]);
    expect(result.optionalArchivalFiles).toBe(4);
  });

  it('partitions mixed outcomes across tracks without processing unaffected tracks', () => {
    const manifest = [
      makeEntry('t1', 'A/A.DAT', 'A/A.EXT'),
      makeEntry('t2', 'B/B.DAT'),
      makeEntry('t3', 'C/C.DAT', 'C/C.EXT'),
      makeEntry('t4', 'D/D.DAT', 'D/D.EXT', null, 'reused'),
    ];
    const matched = [
      makeMatched('A/A.DAT'),
      makeMatched('A/A.EXT'),
      makeMatched('C/C.DAT'),
      makeMatched('C/C.EXT'),
    ];
    const uploaded = new Set(['a/a.dat', 'a/a.ext', 'c/c.dat']);
    const result = buildManifestReconciliation(manifest, matched, uploaded);

    expect(result.expectedFiles).toBe(5);
    expect(result.successfullyUploadedFiles).toBe(3);
    expect(result.failedFiles).toBe(1);
    expect(result.missingFiles).toBe(1);
    expect(result.requiredMissingFiles.map((item) => item.trackId)).toEqual(['t2']);
    expect(result.optionalMissingFiles.map((item) => item.trackId)).toEqual(['t3']);
    expect(result.affectedTrackIds).toEqual(['t2']);
    expect(result.tracksAlreadyReusable).toBe(1);
  });

  it('matches paths case-insensitively', () => {
    const path = 'PIONEER/USBANLZ/P001/A.DAT';
    const result = buildManifestReconciliation(
      [makeEntry('t1', path)],
      [makeMatched(path)],
      new Set([path.toLowerCase()]),
    );
    expect(result.successfullyUploadedFiles).toBe(1);
    expect(result.failedFiles).toBe(0);
  });
});
