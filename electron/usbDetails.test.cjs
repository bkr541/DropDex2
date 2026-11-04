'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findMountPoint, parseDiskutilInfo, prettyFilesystem, readUsbDetails, splitBrandAndModel } = require('./usbDetails.cjs');

test('splits the make and model out of a media name', () => {
  assert.deepEqual(splitBrandAndModel('SanDisk Cruzer Blade Media'), { brand: 'SanDisk', model: 'Cruzer Blade' });
  assert.deepEqual(splitBrandAndModel('Kingston DataTraveler 3.0'), { brand: 'Kingston', model: 'DataTraveler 3.0' });
  assert.deepEqual(splitBrandAndModel('Acme Pocket Drive'), { brand: 'Acme', model: 'Pocket Drive' });
  assert.deepEqual(splitBrandAndModel('Drive'), { brand: null, model: 'Drive' });
  assert.deepEqual(splitBrandAndModel(''), { brand: null, model: null });
  assert.deepEqual(splitBrandAndModel(null), { brand: null, model: null });
});

test('gives file systems their everyday names', () => {
  assert.equal(prettyFilesystem('MS-DOS FAT32', 'msdos'), 'FAT32');
  assert.equal(prettyFilesystem('ExFAT'), 'exFAT');
  assert.equal(prettyFilesystem(undefined, 'apfs'), 'APFS');
  assert.equal(prettyFilesystem('Weird FS'), 'Weird FS');
  assert.equal(prettyFilesystem(null), null);
});

test('reads details from the volume and the whole disk it sits on', () => {
  const details = parseDiskutilInfo(
    { FilesystemName: 'ExFAT', BusProtocol: 'USB', Removable: true, VolumeUUID: 'ABC', DeviceIdentifier: 'disk4s1', SolidState: true, TotalSize: 64000000000 },
    { MediaName: 'SanDisk Ultra Fit Media' },
  );
  assert.equal(details.filesystem, 'exFAT');
  assert.equal(details.brand, 'SanDisk');
  assert.equal(details.model, 'Ultra Fit');
  assert.equal(details.protocol, 'USB');
  assert.equal(details.removable, true);
  assert.equal(details.volumeUuid, 'ABC');
  assert.equal(details.totalBytes, 64000000000);
});

test('keeps working when nothing is known', () => {
  const details = parseDiskutilInfo(null, null);
  assert.equal(details.brand, null);
  assert.equal(details.filesystem, null);
  assert.equal(details.removable, false);
});

test('reads size and free space, and never throws', async () => {
  const details = await readUsbDetails('/Volumes/DJ', {
    platform: 'linux',
    statfs: async () => ({ bsize: 4096, blocks: 1000, bavail: 250 }),
  });
  assert.equal(details.volumeName, 'DJ');
  assert.equal(details.totalBytes, 4096000);
  assert.equal(details.freeBytes, 1024000);
  assert.equal(details.usedBytes, 3072000);
  assert.equal(details.filesystem, null);

  const failed = await readUsbDetails('/gone', { platform: 'linux', statfs: async () => { throw new Error('nope'); } });
  assert.equal(failed.totalBytes, null);
  assert.equal(failed.usedBytes, null);
});

test('on macOS it adds the format and make from diskutil', async () => {
  const run = async (target) => (target.startsWith('/dev/')
    ? { MediaName: 'Lexar JumpDrive Media' }
    : { FilesystemName: 'MS-DOS FAT32', BusProtocol: 'USB', RemovableMedia: true, ParentWholeDisk: 'disk5', TotalSize: 32000000000 });
  const details = await readUsbDetails('/Volumes/DJ', {
    platform: 'darwin',
    statfs: async () => ({ bsize: 4096, blocks: 1000, bavail: 500 }),
    run,
  });
  assert.equal(details.filesystem, 'FAT32');
  assert.equal(details.brand, 'Lexar');
  assert.equal(details.model, 'JumpDrive');
  assert.equal(details.totalBytes, 4096000, 'prefers the size the file system reports');
});

test('finds the drive that holds a folder by walking up to where the device changes', async () => {
  const devices = { '/Volumes/DJ/Sets/House': 7, '/Volumes/DJ/Sets': 7, '/Volumes/DJ': 7, '/Volumes': 1, '/': 1 };
  assert.equal(await findMountPoint('/Volumes/DJ/Sets/House', async (p) => ({ dev: devices[p] })), '/Volumes/DJ');
  assert.equal(await findMountPoint('/Volumes/DJ', async (p) => ({ dev: devices[p] })), '/Volumes/DJ');
});
