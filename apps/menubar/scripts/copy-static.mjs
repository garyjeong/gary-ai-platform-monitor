import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'dist', 'ui');
mkdirSync(dest, { recursive: true });
cpSync(join(root, 'src', 'ui'), dest, { recursive: true });

// Icons for tray + packaging
const iconsDest = join(root, 'dist', 'icons');
mkdirSync(iconsDest, { recursive: true });
const tray = join(root, 'build', 'trayTemplate.png');
const icns = join(root, 'build', 'icon.icns');
const png = join(root, 'build', 'icon-1024.png');
if (existsSync(tray)) cpSync(tray, join(iconsDest, 'trayTemplate.png'));
if (existsSync(icns)) cpSync(icns, join(iconsDest, 'icon.icns'));
if (existsSync(png)) cpSync(png, join(iconsDest, 'icon-1024.png'));
console.log('copied UI assets → dist/ui, icons → dist/icons');
