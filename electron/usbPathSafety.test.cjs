'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  isPathInsideRoot,
  resolveContainedRealPath,
  validateUsbPathSegments,
} = require('./usbPathSafety.cjs');

test('path traversal segments remain blocked', () => {
  assert.equal(validateUsbPathSegments(['Contents', 'track.mp3']), true);
  assert.equal(validateUsbPathSegments(['..', 'secret.mp3']), false);
  assert.equal(validateUsbPathSegments(['Contents/../secret.mp3']), false);
  assert.equal(validateUsbPathSegments(['Contents\\secret.mp3']), false);
  assert.equal(isPathInsideRoot('/usb/root', '/usb/root/Contents/track.mp3'), true);
  assert.equal(isPathInsideRoot('/usb/root', '/usb/other/track.mp3'), false);
});

test('realpath containment rejects a symlink escape', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dropdex-usb-path-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'usb');
  const outside = path.join(base, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.mp3'), 'not usb media');
  await fs.symlink(outside, path.join(root, 'escape'));

  const resolved = await resolveContainedRealPath(
    root,
    path.join(root, 'escape', 'secret.mp3'),
  );
  assert.equal(resolved, null);
});
