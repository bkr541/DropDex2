const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  CueApplyBridge,
  packagedBinaryPath,
  resolveLaunch,
  validateApplyScope,
  validateMetadataApplyScope,
  validateMetadataRecoveryRequest,
  validateSavedDrafts,
  validateSavedMetadataDrafts,
} = require('./cueApplyBridge.cjs');

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


function metadataDraft(overrides = {}) {
  return {
    id: 'metadata-draft-1',
    userId: 'user-1',
    importId: 'import-1',
    trackId: 'track-1',
    field: 'genre',
    schemaVersion: 1,
    pendingValue: 'Techno',
    importedBaselineValue: 'House',
    currentBaselineValue: 'House',
    masterDbId: 'db-main',
    masterContentId: '101',
    revision: 2,
    draftFingerprint: 'd'.repeat(64),
    ...overrides,
  };
}

test('metadata desktop boundary rejects arbitrary targets, unsupported fields, and unexpected keys', () => {
  const pathAttempt = metadataDraft();
  pathAttempt.databasePath = '/tmp/master.db';
  assert.throws(() => validateSavedMetadataDrafts([pathAttempt]), /Forbidden renderer field/);

  assert.throws(
    () => validateSavedMetadataDrafts([metadataDraft({ field: 'comment' })]),
    /Only Genre metadata drafts/,
  );

  const extra = metadataDraft({ surprise: 'nope' });
  assert.throws(() => validateSavedMetadataDrafts([extra]), /unsupported or missing fields/);
});

test('metadata desktop boundary requires strong master identities and normalized Genre', () => {
  assert.throws(
    () => validateSavedMetadataDrafts([metadataDraft({ masterDbId: '' })]),
    /masterDbId/,
  );
  assert.throws(
    () => validateSavedMetadataDrafts([metadataDraft({ pendingValue: ' Techno ' })]),
    /must already be normalized/,
  );
  assert.doesNotThrow(() => validateSavedMetadataDrafts([metadataDraft({ pendingValue: null })]));
});

test('metadata Apply All carries an explicit complete-set count', () => {
  const first = metadataDraft();
  const second = metadataDraft({ id: 'metadata-draft-2', trackId: 'track-2', masterContentId: '102' });
  const rows = [first, second];
  assert.doesNotThrow(() => validateMetadataApplyScope({
    kind: 'all',
    importId: 'import-1',
    expectedDraftCount: 2,
  }, rows));
  assert.throws(() => validateMetadataApplyScope({
    kind: 'all',
    importId: 'import-1',
    expectedDraftCount: 3,
  }, rows), /incomplete/);
  assert.throws(() => validateMetadataApplyScope({
    kind: 'all',
    importId: 'import-1',
    expectedDraftCount: 2,
    sql: 'update DjmdContent',
  }, rows), /unsupported or missing fields/);
});

test('metadata Apply Track cannot widen to another persisted draft', () => {
  const row = metadataDraft();
  assert.doesNotThrow(() => validateMetadataApplyScope({
    kind: 'track', importId: 'import-1', trackId: 'track-1',
  }, [row]));
  assert.throws(() => validateMetadataApplyScope({
    kind: 'track', importId: 'import-1', trackId: 'other',
  }, [row]), /exactly the scoped saved draft/);
});


test('metadata apply method sends only the bound token, validated scope, and saved drafts', async () => {
  const bridge = new CueApplyBridge({});
  const captured = [];
  bridge.request = async (operation, payload) => {
    captured.push({ operation, payload });
    return { ok: true, state: 'applied' };
  };
  const row = metadataDraft();
  const scope = { kind: 'all', importId: 'import-1', expectedDraftCount: 1 };
  const result = await bridge.metadataApply('x'.repeat(32), scope, [row]);
  assert.deepEqual(result, { ok: true, state: 'applied' });
  assert.deepEqual(captured, [{
    operation: 'metadataApply',
    payload: { token: 'x'.repeat(32), scope, savedDrafts: [row] },
  }]);

  assert.throws(
    () => bridge.metadataApply('short', scope, [row]),
    /Metadata preflight token is invalid/,
  );
});


function metadataRecovery(overrides = {}) {
  return {
    operationId: 'metadata-operation-1',
    trackId: 'track-1',
    field: 'genre',
    masterDbId: 'db-main',
    masterContentId: '101',
    appliedRevision: 2,
    draftFingerprint: 'a'.repeat(64),
    planFingerprint: 'b'.repeat(64),
    appliedValue: 'Techno',
    sourceIdentityAfter: 'c'.repeat(64),
    ...overrides,
  };
}

test('metadata recovery boundary is exact, strong-identity bound, and path-free', () => {
  assert.doesNotThrow(() => validateMetadataRecoveryRequest(metadataRecovery()));
  assert.throws(() => validateMetadataRecoveryRequest(metadataRecovery({ field: 'comment' })), /Only Genre/);
  assert.throws(() => validateMetadataRecoveryRequest(metadataRecovery({ sourceIdentityAfter: 'bad' })), /sourceIdentityAfter/);
  assert.throws(() => validateMetadataRecoveryRequest({ ...metadataRecovery(), databasePath: '/tmp/master.db' }), /Forbidden renderer field/);
});

test('metadata recovery method forwards only the validated evidence object', async () => {
  const bridge = new CueApplyBridge({});
  const captured = [];
  bridge.request = async (operation, payload) => {
    captured.push({ operation, payload });
    return { ok: true, state: 'verified' };
  };
  const recovery = metadataRecovery();
  const result = await bridge.metadataRecoveryVerify(recovery);
  assert.deepEqual(result, { ok: true, state: 'verified' });
  assert.deepEqual(captured, [{ operation: 'metadataRecoveryVerify', payload: { recovery } }]);
});
