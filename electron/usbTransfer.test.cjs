'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { assertSafeTransferPaths, categoryForTopLevel, isSystemName, runTransfer, scanTransferSource } = require('./usbTransfer.cjs');

async function makeDrive(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dropdex-transfer-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  return root;
}

const SOURCE = {
  'Contents/Artist/Album/one.mp3': 'aaaa',
  'Contents/Artist/Album/two.mp3': 'bbbbbb',
  'PIONEER/rekordbox/export.pdb': 'db',
  'PIONEER/USBANLZ/P001/ANLZ0000.DAT': 'anlz',
  'Notes.txt': 'hello',
  '.Spotlight-V100/junk': 'x',
  'System Volume Information/junk': 'x',
};

test('files are grouped into tracks, Rekordbox data and other', () => {
  assert.equal(categoryForTopLevel('Contents'), 'tracks');
  assert.equal(categoryForTopLevel('Music'), 'tracks');
  assert.equal(categoryForTopLevel('PIONEER'), 'rekordbox');
  assert.equal(categoryForTopLevel('Notes.txt'), 'other');
  assert.equal(isSystemName('.Spotlight-V100'), true);
  assert.equal(isSystemName('._hidden'), true);
  assert.equal(isSystemName('Contents'), false);
});

test('the same folder, or one inside the other, is refused', () => {
  assert.throws(() => assertSafeTransferPaths('/a/usb', '/a/usb'));
  assert.throws(() => assertSafeTransferPaths('/a/usb', '/a/usb/copy'));
  assert.throws(() => assertSafeTransferPaths('/a/usb/copy', '/a/usb'));
  assert.throws(() => assertSafeTransferPaths('', '/b'));
  assert.doesNotThrow(() => assertSafeTransferPaths('/Volumes/A', '/Volumes/B'));
});

test('a scan counts files and bytes per kind and ignores system files', async (t) => {
  const source = await makeDrive(SOURCE);
  t.after(() => fs.rm(source, { recursive: true, force: true }));
  const scan = await scanTransferSource(source);
  assert.deepEqual(scan.tracks, { fileCount: 2, totalBytes: 10 });
  assert.deepEqual(scan.rekordbox, { fileCount: 2, totalBytes: 6 });
  assert.deepEqual(scan.other, { fileCount: 1, totalBytes: 5 });
});

test('copies only the chosen kinds, keeps the folder layout, and reports every file', async (t) => {
  const source = await makeDrive(SOURCE);
  const destination = await makeDrive({});
  t.after(() => Promise.all([fs.rm(source, { recursive: true, force: true }), fs.rm(destination, { recursive: true, force: true })]));
  const progress = [];
  const result = await runTransfer({ sourceRoot: source, destinationRoot: destination, categories: ['tracks', 'rekordbox'], onProgress: (p) => progress.push(p) });
  assert.equal(result.status, 'completed');
  assert.equal(result.copied, 4);
  assert.equal(result.bytes, 16);
  assert.equal(await fs.readFile(path.join(destination, 'Contents/Artist/Album/one.mp3'), 'utf8'), 'aaaa');
  assert.equal(await fs.readFile(path.join(destination, 'PIONEER/rekordbox/export.pdb'), 'utf8'), 'db');
  await assert.rejects(fs.stat(path.join(destination, 'Notes.txt')));
  await assert.rejects(fs.stat(path.join(destination, '.Spotlight-V100')));
  assert.deepEqual(result.files.map((f) => f.path).sort(), [
    'Contents/Artist/Album/one.mp3', 'Contents/Artist/Album/two.mp3', 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', 'PIONEER/rekordbox/export.pdb',
  ]);
  assert.equal(progress.length, 4);
  assert.equal(progress.at(-1).copied, 4);
});

test('never overwrites a file that is already on the destination', async (t) => {
  const source = await makeDrive({ 'Contents/a.mp3': 'new-version' });
  const destination = await makeDrive({ 'Contents/a.mp3': 'old' });
  t.after(() => Promise.all([fs.rm(source, { recursive: true, force: true }), fs.rm(destination, { recursive: true, force: true })]));
  const result = await runTransfer({ sourceRoot: source, destinationRoot: destination, categories: ['tracks'] });
  assert.equal(result.copied, 0);
  assert.equal(result.skipped, 1);
  assert.equal(await fs.readFile(path.join(destination, 'Contents/a.mp3'), 'utf8'), 'old');
  assert.equal(result.files[0].status, 'skipped');
});

test('can be cancelled between files, and leaves the source untouched', async (t) => {
  const source = await makeDrive(SOURCE);
  const destination = await makeDrive({});
  t.after(() => Promise.all([fs.rm(source, { recursive: true, force: true }), fs.rm(destination, { recursive: true, force: true })]));
  let calls = 0;
  const result = await runTransfer({ sourceRoot: source, destinationRoot: destination, categories: ['tracks', 'rekordbox', 'other'], isCancelled: () => ++calls > 2 });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.copied, 2);
  assert.equal(await fs.readFile(path.join(source, 'Contents/Artist/Album/one.mp3'), 'utf8'), 'aaaa');
});

test('refuses an empty choice and unsafe drives', async () => {
  await assert.rejects(runTransfer({ sourceRoot: '/a', destinationRoot: '/b', categories: [] }), /Choose what to transfer/);
  await assert.rejects(runTransfer({ sourceRoot: '/a', destinationRoot: '/a/b', categories: ['tracks'] }), /inside the other/);
});
