'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { mkdtemp, rm } = require('node:fs/promises');
const { getOrCreateInstallationId, isInstallationId } = require('./installationIdentity.cjs');

test('installation identity is stable for one userData directory and distinct across installations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-installation-'));
  try {
    const firstRoot = path.join(root, 'first');
    const secondRoot = path.join(root, 'second');
    const first = await getOrCreateInstallationId(firstRoot);
    const repeated = await getOrCreateInstallationId(firstRoot);
    const second = await getOrCreateInstallationId(secondRoot);

    assert.equal(isInstallationId(first), true);
    assert.equal(repeated, first);
    assert.notEqual(second, first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
