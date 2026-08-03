import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'dist', 'ui');
mkdirSync(dest, { recursive: true });
cpSync(join(root, 'src', 'ui'), dest, { recursive: true });
console.log('copied UI assets → dist/ui');
