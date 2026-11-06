'use strict';

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { promises: fs } = require('node:fs');

// Makes the 160 kbps AAC preview of one audio file with the ffmpeg that ships inside the app. It only reads the original
// and writes to a temporary file, which is deleted as soon as the preview has been read back.

const BITRATE_KBPS = 160;
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const ENCODE_TIMEOUT_MS = 180_000;

/** The bundled ffmpeg. In a packaged app the binary is unpacked from the asar archive. */
function resolveFfmpegPath(requireFn = require) {
  const bundled = requireFn('ffmpeg-static');
  if (!bundled) throw new Error('The bundled ffmpeg is missing for this platform.');
  return String(bundled).replace('app.asar', 'app.asar.unpacked');
}

function buildEncodeArgs(sourcePath, outputPath) {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', sourcePath,
    '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
    '-c:a', 'aac', '-b:a', `${BITRATE_KBPS}k`, '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    '-movflags', '+faststart',
    outputPath,
  ];
}

/** "Duration: 00:03:21.45, ..." → 201450. Returns null when ffmpeg did not report one. */
function parseDurationMs(text) {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(String(text));
  if (!match) return null;
  const [, h, m, s, fraction = '0'] = match;
  const ms = Math.round(Number(`0.${fraction}`) * 1000);
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
}

function runFfmpeg(binary, args, execFileFn = execFile) {
  return new Promise((resolve, reject) => {
    execFileFn(binary, args, { timeout: ENCODE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !(args.includes('-i') && args.length === 3)) {
        const detail = String(stderr || '').trim().split('\n').pop();
        reject(new Error(detail || (error.killed ? 'ffmpeg took too long and was stopped.' : error.message)));
        return;
      }
      resolve(String(stderr || ''));
    });
  });
}

/**
 * Encodes `sourcePath` to a 160 kbps AAC preview and returns its bytes. Throws with a plain message if the file cannot be read
 * or is not audio.
 */
async function encodePreview(sourcePath, { ffmpegPath, tmpDir = os.tmpdir(), run = runFfmpeg } = {}) {
  const binary = ffmpegPath || resolveFfmpegPath();
  const outputPath = path.join(tmpDir, `dropdex-preview-${crypto.randomUUID()}.m4a`);
  try {
    await run(binary, buildEncodeArgs(sourcePath, outputPath));
    const bytes = await fs.readFile(outputPath);
    if (bytes.length === 0) throw new Error('ffmpeg produced an empty file.');
    // Reading the duration back from the finished file is the most reliable way to get it.
    const info = await run(binary, ['-hide_banner', '-i', outputPath]).catch((error) => String(error && error.message));
    return {
      bytes,
      sizeBytes: bytes.length,
      durationMs: parseDurationMs(info),
      bitrateKbps: BITRATE_KBPS,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
    };
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

module.exports = { BITRATE_KBPS, buildEncodeArgs, encodePreview, parseDurationMs, resolveFfmpegPath };
