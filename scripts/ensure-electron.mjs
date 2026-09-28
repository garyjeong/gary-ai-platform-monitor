/**
 * Electron ≥42 no longer downloads its binary in a postinstall script; it downloads on
 * first launch. `npm run app` calls this to fetch it up front with a clear message,
 * so a first run does not look like a hang. Safe to run repeatedly.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let electronPkgDir;
try {
  electronPkgDir = dirname(require.resolve('electron/package.json', { paths: [join(root, 'apps', 'menubar')] }));
} catch {
  console.warn('[ensure-electron] electron package not installed (run npm install)');
  process.exit(0);
}

const binary = join(electronPkgDir, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
if (process.platform === 'darwin' && existsSync(binary)) {
  process.exit(0);
}

const installer = join(electronPkgDir, 'install.js');
if (!existsSync(installer)) {
  console.warn('[ensure-electron] install.js not found; Electron will download on first launch');
  process.exit(0);
}
console.log('[ensure-electron] downloading Electron binary…');
const res = spawnSync(process.execPath, [installer], { cwd: electronPkgDir, stdio: 'inherit' });
process.exit(res.status ?? 0);
