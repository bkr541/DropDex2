const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const explicit = process.env.DROPDEX_PYTHON;
const command = explicit || (process.platform === 'win32' ? 'py' : 'python3');
const args = [];
if (!explicit && process.platform === 'win32') args.push('-3');
args.push(path.join(root, 'scripts', 'build-rekordbox-bridge.py'));

const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
if (result.error) {
  console.error(`Failed to start Python for packaged bridge build: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
