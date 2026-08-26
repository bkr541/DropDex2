const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { existsSync } = require('node:fs');

const RESULT_PREFIX = 'DROPDEX_BRIDGE_RESULT:';
const PROTOCOL_VERSION = 2;
const MAX_PAYLOAD_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 120_000;
const FORBIDDEN_KEYS = new Set(['databasePath', 'database_path', 'dbPath', 'db_path', 'sql', 'shell', 'argv', 'path']);

function assertNoForbiddenKeys(value, location = 'payload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`Forbidden renderer field: ${location}.${key}`);
    assertNoForbiddenKeys(nested, `${location}.${key}`);
  }
}

function validateSavedDrafts(savedDrafts) {
  if (!Array.isArray(savedDrafts) || savedDrafts.length === 0 || savedDrafts.length > 5000) {
    throw new Error('savedDrafts must contain between 1 and 5000 persisted drafts.');
  }
  assertNoForbiddenKeys(savedDrafts);
  for (const row of savedDrafts) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Each saved draft must be an object.');
    if (!Number.isInteger(row.revision) || row.revision <= 0) throw new Error('Saved draft revision is invalid.');
    if (typeof row.desiredFingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(row.desiredFingerprint)) {
      throw new Error('Saved draft desired fingerprint is invalid.');
    }
    if (typeof row.importedBaselineFingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(row.importedBaselineFingerprint)) {
      throw new Error('Saved draft baseline fingerprint is invalid.');
    }
    if (row.importedBaselineLocalCueFingerprint != null
      && (typeof row.importedBaselineLocalCueFingerprint !== 'string'
        || !/^[0-9a-f]{64}$/i.test(row.importedBaselineLocalCueFingerprint))) {
      throw new Error('Saved draft local Rekordbox cue baseline fingerprint is invalid.');
    }
    if (row.currentBaselineFingerprint != null
      && (typeof row.currentBaselineFingerprint !== 'string'
        || !/^[0-9a-f]{64}$/i.test(row.currentBaselineFingerprint))) {
      throw new Error('Saved draft current baseline fingerprint is invalid.');
    }
    if (row.currentBaselineLocalCueFingerprint != null
      && (typeof row.currentBaselineLocalCueFingerprint !== 'string'
        || !/^[0-9a-f]{64}$/i.test(row.currentBaselineLocalCueFingerprint))) {
      throw new Error('Saved draft current local Rekordbox cue baseline fingerprint is invalid.');
    }
    for (const field of ['masterDbId', 'masterContentId']) {
      if (row[field] != null
        && (typeof row[field] !== 'string' || row[field].length < 1 || row[field].length > 256)) {
        throw new Error(`Saved draft ${field} is invalid.`);
      }
    }
    const document = row.desiredDocument;
    if (!document || typeof document !== 'object' || Array.isArray(document) || !Array.isArray(document.cues)) {
      throw new Error('Saved draft document is invalid.');
    }
    if (document.cues.length > 64) throw new Error('Saved draft cue count exceeds the desktop safety limit.');
    for (const field of ['importId', 'trackId', 'rekordboxContentId']) {
      if (typeof document[field] !== 'string' || document[field].length < 1 || document[field].length > 256) {
        throw new Error(`Saved draft ${field} is invalid.`);
      }
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(savedDrafts), 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) throw new Error('Cue apply payload is too large.');
}

function validateApplyScope(scope, savedDrafts) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('Cue apply scope is invalid.');
  if (scope.kind !== 'track' && scope.kind !== 'all') throw new Error('Cue apply scope kind is invalid.');
  if (typeof scope.importId !== 'string' || scope.importId.length < 1 || scope.importId.length > 256) {
    throw new Error('Cue apply scope importId is invalid.');
  }
  const expectedKeys = scope.kind === 'track' ? ['importId', 'kind', 'trackId'] : ['importId', 'kind'];
  const actualKeys = Object.keys(scope).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Cue apply scope contains unsupported fields.');
  }
  if (scope.kind === 'track' && (typeof scope.trackId !== 'string' || scope.trackId.length < 1 || scope.trackId.length > 256)) {
    throw new Error('Cue apply scope trackId is invalid.');
  }
  for (const row of savedDrafts) {
    if (row.importId !== scope.importId || row.desiredDocument?.importId !== scope.importId) {
      throw new Error('Cue apply scope does not match the saved draft import.');
    }
  }
  if (scope.kind === 'track') {
    if (savedDrafts.length !== 1) throw new Error('Apply Track requires exactly one saved cue draft.');
    const row = savedDrafts[0];
    if (row.trackId !== scope.trackId || row.desiredDocument?.trackId !== scope.trackId) {
      throw new Error('Apply Track scope does not match the saved cue draft track.');
    }
  }
}

function packagedBinaryPath(resourcesPath, platform = process.platform) {
  const filename = platform === 'win32' ? 'dropdex-rekordbox-bridge.exe' : 'dropdex-rekordbox-bridge';
  return path.join(resourcesPath, 'rekordbox-bridge', filename);
}

function resolveLaunch({ isPackaged, resourcesPath, appPath, env = process.env, platform = process.platform }) {
  if (isPackaged) {
    const binary = packagedBinaryPath(resourcesPath, platform);
    return existsSync(binary) ? { command: binary, args: [], cwd: path.dirname(binary), packaged: true } : null;
  }
  if (env.DROPDEX_REKORDBOX_BRIDGE_BINARY) {
    return { command: env.DROPDEX_REKORDBOX_BRIDGE_BINARY, args: [], cwd: appPath, packaged: false };
  }
  const runtimeBinary = path.join(appPath, 'bridge', 'runtime', platform === 'win32' ? 'dropdex-rekordbox-bridge.exe' : 'dropdex-rekordbox-bridge');
  if (existsSync(runtimeBinary)) return { command: runtimeBinary, args: [], cwd: path.dirname(runtimeBinary), packaged: false };
  return {
    command: env.DROPDEX_PYTHON || (platform === 'win32' ? 'python' : 'python3'),
    args: ['-m', 'rekordbox_bridge.desktop_service'],
    cwd: path.join(appPath, 'bridge'),
    packaged: false,
  };
}

class CueApplyBridge {
  constructor(options) {
    this.options = options;
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.startError = null;
  }

  _start() {
    if (this.child && !this.child.killed) return;
    const launch = resolveLaunch(this.options);
    if (!launch) throw new Error('The packaged Rekordbox apply bridge is unavailable. Reinstall DropDex.');
    this.startError = null;
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: launch.packaged ? { ...process.env } : { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._consume(chunk));
    child.stderr.on('data', () => {}); // deliberately do not forward path-heavy bridge stderr to renderer
    child.on('error', (error) => {
      this.startError = error;
      this._failAll(`Rekordbox apply bridge failed to start: ${error.message}`);
    });
    child.on('exit', (code) => {
      this.child = null;
      this._failAll(`Rekordbox apply bridge exited unexpectedly (${code ?? 'unknown'}).`);
    });
  }

  _consume(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.startsWith(RESULT_PREFIX)) {
        try {
          const payload = JSON.parse(line.slice(RESULT_PREFIX.length));
          const pending = this.pending.get(payload.requestId);
          if (pending) {
            this.pending.delete(payload.requestId);
            clearTimeout(pending.timer);
            if (payload.ok) pending.resolve(payload.result);
            else pending.reject(new Error(payload.error || 'Rekordbox apply bridge request failed.'));
          }
        } catch { /* unrelated or malformed stdout is ignored */ }
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  _failAll(message) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  async request(operation, payload = {}) {
    if (!['availability', 'preflight', 'apply'].includes(operation)) throw new Error('Unsupported cue apply operation.');
    this._start();
    if (!this.child?.stdin?.writable) throw new Error(this.startError?.message || 'Rekordbox apply bridge is unavailable.');
    const requestId = crypto.randomUUID();
    const body = { protocolVersion: PROTOCOL_VERSION, requestId, operation, ...payload };
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('Cue apply request is too large.');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Rekordbox apply bridge request timed out.'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.child.stdin.write(`${serialized}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async availability() {
    try {
      const result = await this.request('availability');
      return { available: result?.available === true, reason: null };
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  preflight(scope, savedDrafts) {
    validateSavedDrafts(savedDrafts);
    validateApplyScope(scope, savedDrafts);
    return this.request('preflight', { scope, savedDrafts });
  }

  apply(token, scope, savedDrafts) {
    if (typeof token !== 'string' || token.length < 16 || token.length > 512) throw new Error('Preflight token is invalid.');
    validateSavedDrafts(savedDrafts);
    validateApplyScope(scope, savedDrafts);
    return this.request('apply', { token, scope, savedDrafts });
  }

  close() {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this._failAll('Rekordbox apply bridge closed.');
  }
}

module.exports = { CueApplyBridge, packagedBinaryPath, resolveLaunch, validateApplyScope, validateSavedDrafts };
