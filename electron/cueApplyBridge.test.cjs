const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { packagedBinaryPath, resolveLaunch, validateApplyScope, validateSavedDrafts } = require('./cueApplyBridge.cjs');

function draft() {
  return {
    importId: 'import-1',
    trackId: 'track-1',
    rekordboxContentId: '101',
    revision: 2,
    desiredFingerprint: 'a'.repeat(64),
    importedBaselineFingerprint: 'b'.repeat(64),
    importedBaselineLocalCueFingerprint: 'c'.repeat(64),
    currentBaselineFingerprint: 'b'.repeat(64),
    currentBaselineLocalCueFingerprint: 'c'.repeat(64),
    masterDbId: 'db-main',
    masterContentId: '101',
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


test('legacy drafts may omit Stage 1 safety fields so preflight can block them safely', () => {
  const row = draft();
  delete row.importedBaselineLocalCueFingerprint;
  delete row.masterDbId;
  delete row.masterContentId;
  assert.doesNotThrow(() => validateSavedDrafts([row]));
});

test('Stage 10 moving baseline fields are optional for legacy drafts but validated when present', () => {
  const legacy = draft();
  delete legacy.currentBaselineFingerprint;
  delete legacy.currentBaselineLocalCueFingerprint;
  assert.doesNotThrow(() => validateSavedDrafts([legacy]));

  const badCurrent = draft();
  badCurrent.currentBaselineFingerprint = 'bad';
  assert.throws(() => validateSavedDrafts([badCurrent]), /current baseline fingerprint/);

  const badLocal = draft();
  badLocal.currentBaselineLocalCueFingerprint = 'bad';
  assert.throws(() => validateSavedDrafts([badLocal]), /current local Rekordbox cue baseline fingerprint/);
});

test('malformed Stage 1 safety fields are rejected at the desktop boundary', () => {
  const badHash = draft();
  badHash.importedBaselineLocalCueFingerprint = 'not-a-hash';
  assert.throws(() => validateSavedDrafts([badHash]), /local Rekordbox cue baseline fingerprint/);

  const badIdentity = draft();
  badIdentity.masterContentId = '';
  assert.throws(() => validateSavedDrafts([badIdentity]), /masterContentId/);
});

test('Apply Track scope is enforced as exactly one matching persisted track', () => {
  const row = draft();
  assert.doesNotThrow(() => validateApplyScope({ kind: 'track', importId: 'import-1', trackId: 'track-1' }, [row]));
  assert.throws(
    () => validateApplyScope({ kind: 'track', importId: 'import-1', trackId: 'track-1' }, [row, row]),
    /exactly one/,
  );
  assert.throws(
    () => validateApplyScope({ kind: 'track', importId: 'import-1', trackId: 'other' }, [row]),
    /does not match/,
  );
});

test('Apply All scope cannot cross import identity', () => {
  const row = draft();
  const other = draft();
  other.importId = 'import-2';
  other.desiredDocument.importId = 'import-2';
  assert.throws(
    () => validateApplyScope({ kind: 'all', importId: 'import-1' }, [row, other]),
    /does not match the saved draft import/,
  );
});
