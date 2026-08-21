const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { packagedBinaryPath, resolveLaunch, validateSavedDrafts } = require('./cueApplyBridge.cjs');

function draft() {
  return {
    importId: 'import-1',
    trackId: 'track-1',
    rekordboxContentId: '101',
    revision: 2,
    desiredFingerprint: 'a'.repeat(64),
    importedBaselineFingerprint: 'b'.repeat(64),
    desiredDocument: {
      schemaVersion: 1,
      importId: 'import-1',
      trackId: 'track-1',
      rekordboxContentId: '101',
      cues: [],
    },
  };
}

test('renderer cannot smuggle databasePath through saved drafts', () => {
  const row = draft();
  row.databasePath = '/tmp/master.db';
  assert.throws(() => validateSavedDrafts([row]), /Forbidden renderer field/);
});

test('renderer cannot smuggle nested path or SQL through desired document', () => {
  const row = draft();
  row.desiredDocument.cues.push({ path: '/Volumes/USB/PIONEER/master.db', sql: 'delete from djmdCue' });
  assert.throws(() => validateSavedDrafts([row]), /Forbidden renderer field/);
});

test('packaged resolution has no ambient Python fallback', () => {
  const target = packagedBinaryPath('/definitely-missing-resources', process.platform);
  assert.equal(path.basename(target).startsWith('dropdex-rekordbox-bridge'), true);
  const launch = resolveLaunch({
    isPackaged: true,
    resourcesPath: '/definitely-missing-resources',
    appPath: '/source',
    env: { DROPDEX_PYTHON: 'unsafe-python' },
    platform: process.platform,
  });
  assert.equal(launch, null);
});

test('development resolution is allowed to use the source module', () => {
  const launch = resolveLaunch({
    isPackaged: false,
    resourcesPath: '/unused',
    appPath: path.resolve(__dirname, '..'),
    env: {},
    platform: process.platform,
  });
  assert.ok(launch);
  assert.ok(launch.args.includes('rekordbox_bridge.desktop_service') || launch.command.includes('dropdex-rekordbox-bridge'));
});
