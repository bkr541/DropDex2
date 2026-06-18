import { describe, expect, it } from 'vitest';
import { buildResumeTargets, buildResumeMatchResult } from './resumeAnalysis';
import type { AnalysisStatusResponse } from '../api/rekordboxImport';

// ── helpers ───────────────────────────────────────────────────────────────────

function mockStatus(
  required: string[] = [],
  ext: string[] = [],
  twoEx: string[] = [],
): AnalysisStatusResponse {
  return {
    import_id: 'imp1',
    analysis_status: 'partial',
    expected_track_count: 10,
    matched_track_count: 8,
    parsed_track_count: 8,
    failed_track_count: 0,
    asset_count: 30,
    missing_required_paths: required,
    missing_optional_ext: ext,
    missing_optional_2ex: twoEx,
    parser_version: null,
    warnings: [],
    // New structured-target fields (empty = legacy mode, use path arrays above)
    unresolved_targets: [],
    missing_required_count: 0,
    missing_optional_count: 0,
    failed_upload_count: 0,
    failed_parse_count: 0,
    affected_track_count: 0,
  };
}

function mockFile(name: string, webkitRelativePath = '', size = 100): File {
  return { name, webkitRelativePath, size, type: '' } as unknown as File;
}

// ── buildResumeTargets ─────────────────────────────────────────────────────────

describe('buildResumeTargets', () => {
  it('returns empty array when nothing is missing', () => {
    expect(buildResumeTargets(mockStatus())).toEqual([]);
  });

  it('maps required paths to required=true DAT targets', () => {
    const targets = buildResumeTargets(
      mockStatus(['PIONEER/USBANLZ/P001/ANLZ0000.DAT']),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', assetType: 'DAT', required: true });
  });

  it('maps optional_ext paths to required=false EXT targets', () => {
    const targets = buildResumeTargets(
      mockStatus([], ['PIONEER/USBANLZ/P001/ANLZ0000.EXT']),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ assetType: 'EXT', required: false });
  });

  it('maps optional_2ex paths to required=false 2EX targets', () => {
    const targets = buildResumeTargets(
      mockStatus([], [], ['PIONEER/USBANLZ/P001/ANLZ0000.2EX']),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ assetType: '2EX', required: false });
  });

  it('aggregates all three types together', () => {
    const targets = buildResumeTargets(
      mockStatus(
        ['PIONEER/USBANLZ/P001/ANLZ0000.DAT'],
        ['PIONEER/USBANLZ/P001/ANLZ0000.EXT'],
        ['PIONEER/USBANLZ/P001/ANLZ0000.2EX'],
      ),
    );
    expect(targets).toHaveLength(3);
    const types = targets.map((t) => t.assetType);
    expect(types).toContain('DAT');
    expect(types).toContain('EXT');
    expect(types).toContain('2EX');
  });
});

// ── buildResumeMatchResult ─────────────────────────────────────────────────────

describe('buildResumeMatchResult — no targets', () => {
  it('returns all-empty result when targets list is empty', () => {
    const files = [mockFile('ANLZ0000.DAT', 'MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    const result = buildResumeMatchResult(files, []);
    expect(result.matched).toHaveLength(0);
    expect(result.stillMissing).toHaveLength(0);
  });
});

describe('buildResumeMatchResult — happy path', () => {
  const targets = buildResumeTargets(
    mockStatus(
      ['PIONEER/USBANLZ/P001/ANLZ0000.DAT'],
      ['PIONEER/USBANLZ/P001/ANLZ0000.EXT'],
    ),
  );

  it('matches files by canonical PIONEER-anchored path', () => {
    const files = [
      mockFile('ANLZ0000.DAT', 'MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
      mockFile('ANLZ0000.EXT', 'MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.EXT'),
    ];
    const result = buildResumeMatchResult(files, targets);
    expect(result.matched).toHaveLength(2);
    expect(result.stillMissing).toHaveLength(0);
    expect(result.stillMissingRequired).toHaveLength(0);
    expect(result.stillMissingOptional).toHaveLength(0);
  });

  it('matching is case-insensitive', () => {
    const files = [
      mockFile('ANLZ0000.dat', 'MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.dat'),
    ];
    const result = buildResumeMatchResult(files, targets);
    // DAT matched, EXT still missing
    expect(result.matched).toHaveLength(1);
    expect(result.stillMissing).toHaveLength(1);
    expect(result.stillMissingOptional).toHaveLength(1);
  });

  it('sets assetType from the target, not the file extension heuristic', () => {
    const files = [
      mockFile('ANLZ0000.DAT', 'MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
    ];
    const result = buildResumeMatchResult(files, targets);
    expect(result.matched[0].assetType).toBe('DAT');
  });
});

describe('buildResumeMatchResult — missing files', () => {
  it('reports required stillMissing separately from optional', () => {
    const targets = buildResumeTargets(
      mockStatus(
        ['PIONEER/USBANLZ/P001/ANLZ0000.DAT'],
        ['PIONEER/USBANLZ/P001/ANLZ0000.EXT'],
      ),
    );
    const result = buildResumeMatchResult([], targets);
    expect(result.matched).toHaveLength(0);
    expect(result.stillMissing).toHaveLength(2);
    expect(result.stillMissingRequired).toHaveLength(1);
    expect(result.stillMissingRequired[0].assetType).toBe('DAT');
    expect(result.stillMissingOptional).toHaveLength(1);
    expect(result.stillMissingOptional[0].assetType).toBe('EXT');
  });
});

describe('buildResumeMatchResult — extra files ignored', () => {
  it('ignores files whose canonical path is not in targets', () => {
    const targets = buildResumeTargets(mockStatus(['PIONEER/USBANLZ/P001/ANLZ0000.DAT']));
    const files = [
      mockFile('ANLZ0001.DAT', 'MY_USB/PIONEER/USBANLZ/P002/ANLZ0001.DAT'), // different path
      mockFile('ANLZ0000.DAT', 'MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT'), // matches
    ];
    const result = buildResumeMatchResult(files, targets);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].canonicalPath).toBe('PIONEER/USBANLZ/P001/ANLZ0000.DAT');
  });
});

describe('buildResumeMatchResult — no duplicates', () => {
  it('matches each target only once even if duplicated in file list', () => {
    const targets = buildResumeTargets(mockStatus(['PIONEER/USBANLZ/P001/ANLZ0000.DAT']));
    const files = [
      mockFile('ANLZ0000.DAT', 'MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
      mockFile('ANLZ0000.DAT', 'ANOTHER_USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
    ];
    const result = buildResumeMatchResult(files, targets);
    expect(result.matched).toHaveLength(1);
  });
});

describe('buildResumeMatchResult — path normalization', () => {
  it('matches files with backslashes in webkitRelativePath', () => {
    const targets = buildResumeTargets(mockStatus(['PIONEER/USBANLZ/P001/ANLZ0000.DAT']));
    const files = [
      mockFile('ANLZ0000.DAT', 'MY_USB\\PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT'),
    ];
    const result = buildResumeMatchResult(files, targets);
    expect(result.matched).toHaveLength(1);
  });

  it('matches files with a Windows drive letter prefix', () => {
    const targets = buildResumeTargets(mockStatus(['PIONEER/USBANLZ/P001/ANLZ0000.DAT']));
    const files = [
      mockFile('ANLZ0000.DAT', 'D:\\MY_USB\\PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT'),
    ];
    const result = buildResumeMatchResult(files, targets);
    expect(result.matched).toHaveLength(1);
  });

  it('matches files with duplicate slashes in the path', () => {
    const targets = buildResumeTargets(mockStatus(['PIONEER/USBANLZ/P001/ANLZ0000.DAT']));
    const files = [
      mockFile('ANLZ0000.DAT', 'MY_USB//PIONEER//USBANLZ//P001//ANLZ0000.DAT'),
    ];
    const result = buildResumeMatchResult(files, targets);
    expect(result.matched).toHaveLength(1);
  });
});
