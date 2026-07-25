import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FRONTEND_USB_FLOW_FILES = [
  'src/components/ImportLibraryModal.tsx',
  'src/components/ResumeAnalysisModal.tsx',
  'src/lib/api/rekordboxImport.ts',
  'src/lib/rekordbox/analysisPaths.ts',
];

const FORBIDDEN_USB_WRITE_APIS = [
  'fs.writeFile',
  'fs.unlink',
  'fs.rename',
  'fs.rm',
  'createWriteStream',
  'createWritable(',
  'FileSystemWritableFileStream',
];

describe('Rekordbox browser USB import read-only contract', () => {
  it('contains no filesystem or File System Access write operation', () => {
    const source = FRONTEND_USB_FLOW_FILES
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    for (const forbiddenApi of FORBIDDEN_USB_WRITE_APIS) {
      expect(source, `${forbiddenApi} must not appear in the USB import flow`).not.toContain(forbiddenApi);
    }
  });

  it('keeps cloud parsing ID-only and after verified USB release', () => {
    const source = readFileSync('src/components/ImportLibraryModal.tsx', 'utf8');
    const cloudStart = source.indexOf('const runCloudParsing = async');
    const importHandlerStart = source.indexOf('const handleImport = async', cloudStart);
    const cloudSection = source.slice(cloudStart, importHandlerStart);

    expect(cloudStart).toBeGreaterThan(-1);
    expect(importHandlerStart).toBeGreaterThan(cloudStart);
    expect(cloudSection).not.toContain('uploadBatchWithRetry(');
    expect(cloudSection).not.toContain('startRekordboxImport(');
    expect(cloudSection).not.toContain('folderScanRef.current');
    expect(cloudSection).not.toContain('matchedFilesRef.current');

    const folderUpload = source.indexOf('const cloudContext = await runUsbFolderUpload');
    const release = source.indexOf('await verifyAndPublishUsbRelease()', folderUpload);
    const cloudParse = source.indexOf('await runCloudParsing(cloudContext', folderUpload);
    expect(folderUpload).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(folderUpload);
    expect(cloudParse).toBeGreaterThan(release);

    const cancellationCatch = source.indexOf('const cancelled =', importHandlerStart);
    const cancellationRelease = source.indexOf('await verifyAndPublishUsbRelease()', cancellationCatch);
    const cloudCancellation = source.indexOf('await cancelCloudWork()', cancellationRelease);
    expect(cancellationCatch).toBeGreaterThan(importHandlerStart);
    expect(cancellationRelease).toBeGreaterThan(cancellationCatch);
    expect(cloudCancellation).toBeGreaterThan(cancellationRelease);
  });
});
