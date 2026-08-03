/**
 * Ensure electron path.txt exists when dist was restored manually
 * (npm allow-scripts can skip postinstall on some environments).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = join(root, 'node_modules', 'electron');
const pathTxt = join(electronDir, 'path.txt');
const macBinary = join(
  electronDir,
  'dist/Electron.app/Contents/MacOS/Electron'
);

if (existsSync(macBinary) && !existsSync(pathTxt)) {
  writeFileSync(pathTxt, 'Electron.app/Contents/MacOS/Electron');
  console.log('[ensure-electron] wrote path.txt');
}

try {
  const require = createRequire(import.meta.url);
  const p = require('electron');
  if (typeof p === 'string' && existsSync(p)) {
    console.log('[ensure-electron] electron binary:', p);
  }
} catch (err) {
  console.warn(
    '[ensure-electron] Electron binary missing. Run: npm install electron --foreground-scripts'
  );
  console.warn(String(err?.message ?? err));
}
