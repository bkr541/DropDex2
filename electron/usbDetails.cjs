'use strict';

const { execFile } = require('node:child_process');
const { promises: fs } = require('node:fs');
const path = require('node:path');

// Reads what the operating system knows about the drive behind a folder: size, free space, format, make and model.
// Size and free space work everywhere. Format, make and model need `diskutil`, so they are only filled in on macOS;
// on other systems they come back as null and the page shows "Unknown".

const KNOWN_BRANDS = [
  'SanDisk', 'Kingston', 'Samsung', 'Lexar', 'PNY', 'Corsair', 'Transcend', 'Toshiba', 'Verbatim', 'Sony', 'Patriot',
  'ADATA', 'Silicon Power', 'Crucial', 'Western Digital', 'WD', 'Seagate', 'HP', 'Apacer', 'Netac', 'Integral', 'Generic',
];

const FILESYSTEM_LABELS = {
  msdos: 'FAT32', fat32: 'FAT32', 'ms-dos fat32': 'FAT32', 'ms-dos fat16': 'FAT16', 'ms-dos': 'FAT',
  exfat: 'exFAT', apfs: 'APFS', hfs: 'Mac OS Extended', 'mac os extended (journaled)': 'Mac OS Extended',
  ntfs: 'NTFS', 'windows nt file system (ntfs)': 'NTFS',
};

function prettyFilesystem(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const key = candidate.trim().toLowerCase();
    if (FILESYSTEM_LABELS[key]) return FILESYSTEM_LABELS[key];
  }
  const first = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return first ? first.trim() : null;
}

/** Splits a media name such as "SanDisk Cruzer Blade Media" into { brand: 'SanDisk', model: 'Cruzer Blade' }. */
function splitBrandAndModel(mediaName) {
  if (typeof mediaName !== 'string') return { brand: null, model: null };
  const cleaned = mediaName.replace(/\bMedia\b\s*$/i, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { brand: null, model: null };
  const known = KNOWN_BRANDS.find((brand) => cleaned.toLowerCase().startsWith(brand.toLowerCase()));
  if (known) {
    const model = cleaned.slice(known.length).trim();
    return { brand: known, model: model || null };
  }
  const [first, ...rest] = cleaned.split(' ');
  return rest.length > 0 ? { brand: first, model: rest.join(' ') } : { brand: null, model: cleaned };
}

/** Pure: turns two parsed `diskutil info` results (the volume, and the whole disk it sits on) into drive details. */
function parseDiskutilInfo(volume, wholeDisk) {
  const info = volume && typeof volume === 'object' ? volume : {};
  const whole = wholeDisk && typeof wholeDisk === 'object' ? wholeDisk : {};
  const mediaName = [whole.MediaName, whole.IORegistryEntryName, info.MediaName].find((value) => typeof value === 'string' && value.trim()) ?? null;
  const { brand, model } = splitBrandAndModel(mediaName);
  const protocol = [info.BusProtocol, whole.BusProtocol].find((value) => typeof value === 'string' && value.trim()) ?? null;
  const removable = Boolean(info.RemovableMedia || info.Removable || whole.RemovableMedia || whole.Removable || info.Ejectable);
  return {
    filesystem: prettyFilesystem(info.FilesystemName, info.FilesystemType),
    brand,
    model,
    protocol,
    solidState: typeof info.SolidState === 'boolean' ? info.SolidState : null,
    removable,
    volumeUuid: typeof info.VolumeUUID === 'string' ? info.VolumeUUID : null,
    deviceId: typeof info.DeviceIdentifier === 'string' ? info.DeviceIdentifier : null,
    totalBytes: Number.isFinite(info.TotalSize) && info.TotalSize > 0 ? info.TotalSize : null,
  };
}

function runDiskutil(target, execFileFn = execFile) {
  return new Promise((resolve) => {
    execFileFn('diskutil', ['info', '-plist', target], { maxBuffer: 4 * 1024 * 1024, timeout: 8000 }, (error, stdout) => {
      if (error || !stdout) return resolve(null);
      const converter = execFileFn('plutil', ['-convert', 'json', '-o', '-', '-'], { maxBuffer: 4 * 1024 * 1024, timeout: 8000 }, (convertError, json) => {
        if (convertError || !json) return resolve(null);
        try { resolve(JSON.parse(json)); } catch { resolve(null); }
      });
      converter.stdin.end(stdout);
    });
  });
}

/** The folder where the drive holding `directory` is mounted: the highest parent that is still on the same drive. */
async function findMountPoint(directory, stat = fs.stat) {
  let current = path.resolve(directory);
  let device = (await stat(current)).dev;
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    const parentDevice = (await stat(parent)).dev;
    if (parentDevice !== device) return current;
    current = parent;
    device = parentDevice;
  }
}

async function readDarwinDetails(rootPath, run = runDiskutil) {
  let volume = await run(rootPath);
  if (!volume) {
    // Not a drive's own folder (for example a folder inside a drive): ask about the drive that holds it.
    const mountPoint = await findMountPoint(rootPath).catch(() => null);
    volume = mountPoint && mountPoint !== rootPath ? await run(mountPoint) : null;
  }
  if (!volume) return null;
  const parent = typeof volume.ParentWholeDisk === 'string' ? volume.ParentWholeDisk : null;
  const whole = parent ? await run(`/dev/${parent}`) : null;
  return parseDiskutilInfo(volume, whole);
}

/**
 * Size, free space and (on macOS) format, make and model for the drive that holds `rootPath`.
 * Never throws: whatever could not be read is null.
 */
async function readUsbDetails(rootPath, { platform = process.platform, statfs = fs.statfs, run = runDiskutil } = {}) {
  const details = {
    volumeName: path.basename(rootPath) || rootPath,
    totalBytes: null,
    freeBytes: null,
    usedBytes: null,
    filesystem: null,
    brand: null,
    model: null,
    protocol: null,
    solidState: null,
    removable: null,
    volumeUuid: null,
    deviceId: null,
  };

  try {
    const stats = await statfs(rootPath);
    details.totalBytes = Number(stats.blocks) * Number(stats.bsize);
    details.freeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch { /* leave null */ }

  if (platform === 'darwin') {
    try {
      const extra = await readDarwinDetails(rootPath, run);
      if (extra) {
        const { totalBytes, ...rest } = extra;
        Object.assign(details, rest);
        if (details.totalBytes == null && totalBytes != null) details.totalBytes = totalBytes;
      }
    } catch { /* leave the OS-level fields null */ }
  }

  if (details.totalBytes != null && details.freeBytes != null) {
    details.usedBytes = Math.max(0, details.totalBytes - details.freeBytes);
  }
  return details;
}

module.exports = { findMountPoint, parseDiskutilInfo, prettyFilesystem, readUsbDetails, splitBrandAndModel };
