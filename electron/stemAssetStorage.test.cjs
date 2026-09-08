'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  deleteStemAssetFile,
  resolveStemAssetFile,
  stemStorageRoot,
  validateStemStorageLocator,
} = require('./stemAssetStorage.cjs');

async function fixture(t) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'dropdex-stems-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const root = stemStorageRoot(userData);
  const locator = 'user-a/track-a/vocals/vocals.wav';
  const filePath = path.join(root, ...locator.split('/'));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'stem-audio');
  return { userData, root, locator, filePath };
}

test('managed stem locators reject traversal and absolute paths', () => {
  assert.equal(validateStemStorageLocator('user/track/vocals.wav'), true);
  assert.equal(validateStemStorageLocator('../outside.wav'), false);
  assert.equal(validateStemStorageLocator('user/../outside.wav'), false);
  assert.equal(validateStemStorageLocator('/tmp/outside.wav'), false);
  assert.equal(validateStemStorageLocator('user\\outside.wav'), false);
  assert.equal(validateStemStorageLocator('user/track/metadata.json'), false);
});

test('ready stem files resolve only inside the DropDex-managed root', async (t) => {
  const { userData, locator, filePath } = await fixture(t);
  const resolved = await resolveStemAssetFile(userData, locator);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.filePath, await fs.realpath(filePath));
  assert.equal(resolved.size, Buffer.byteLength('stem-audio'));
  assert.equal(typeof resolved.mtimeMs, 'number');
});

test('symlink escape is rejected', async (t) => {
  const { userData, root } = await fixture(t);
  const outside = path.join(userData, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.wav'), 'outside');
  await fs.symlink(outside, path.join(root, 'escape'));

  const resolved = await resolveStemAssetFile(userData, 'escape/secret.wav');
  assert.equal(resolved.ok, false);
  assert.equal(resolved.error.kind, 'security');
});

test('delete removes a managed file and treats an already missing file as clean', async (t) => {
  const { userData, locator } = await fixture(t);
  assert.deepEqual(await deleteStemAssetFile(userData, locator), { ok: true, deleted: true });
  assert.deepEqual(await deleteStemAssetFile(userData, locator), { ok: true, deleted: false });
});
