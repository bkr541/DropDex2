'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { promises: fs } = require('node:fs');

const INSTALLATION_ID_FILE = 'installation-id.json';

function installationIdentityPath(userDataPath) {
  return path.join(userDataPath, INSTALLATION_ID_FILE);
}

function isInstallationId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readInstallationId(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return isInstallationId(parsed?.installationId) ? parsed.installationId : null;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function getOrCreateInstallationId(userDataPath) {
  await fs.mkdir(userDataPath, { recursive: true });
  const filePath = installationIdentityPath(userDataPath);
  const existing = await readInstallationId(filePath);
  if (existing) return existing;

  const installationId = crypto.randomUUID();
  const payload = `${JSON.stringify({ installationId }, null, 2)}\n`;
  try {
    await fs.writeFile(filePath, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return installationId;
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'EEXIST')) throw error;
  }

  const raced = await readInstallationId(filePath);
  if (raced) return raced;
  throw new Error('DropDex installation identity file exists but is invalid.');
}

module.exports = {
  INSTALLATION_ID_FILE,
  getOrCreateInstallationId,
  installationIdentityPath,
  isInstallationId,
};
