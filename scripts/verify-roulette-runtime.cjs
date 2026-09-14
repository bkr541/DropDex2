'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { defaultDevelopmentPython, defaultModelRoot } = require('../electron/stemSeparationBridge.cjs');

const root = path.resolve(__dirname, '..');
const env = process.env;
const modelRoot = defaultModelRoot({ isPackaged: false, resourcesPath: '', appPath: root, env });
const command = env.DROPDEX_PYTHON || defaultDevelopmentPython(root, process.platform);
const args = ['-m', 'rekordbox_bridge.stem_separator', '--health-check', '--model-root', modelRoot];
const result = spawnSync(command, args, {
  cwd: path.join(root, 'bridge'),
  env: { ...process.env, PYTHONUNBUFFERED: '1', TORCH_HOME: modelRoot },
  stdio: 'inherit',
});
if (result.error) {
  console.error(`Roulette runtime is unavailable: ${result.error.message}`);
  console.error('Run: npm run setup:roulette-runtime');
  process.exit(1);
}
if (result.status !== 0) {
  console.error('Roulette runtime verification failed. Run: npm run setup:roulette-runtime');
  process.exit(result.status ?? 1);
}
