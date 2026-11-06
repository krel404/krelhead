import { mkdirSync, copyFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const out = resolve('artifacts');
mkdirSync(out, { recursive: true });
const staging = mkdtempSync(join(tmpdir(), 'tome-addon-'));
try {
  cpSync('addon/TomeSnapshot', join(staging, 'TomeSnapshot'), { recursive: true });
  copyFileSync('docs/character-snapshots.md', join(staging, 'README.md'));
  copyFileSync('uploader/tome-uploader.mjs', join(staging, 'tome-uploader.mjs'));
  const destination = join(out, 'TomeSnapshot-0.3.0.zip');
  rmSync(destination, { force: true });
  execFileSync('zip', ['-qr', destination, 'TomeSnapshot', 'README.md', 'tome-uploader.mjs'], { cwd: staging });
  console.log(destination);
} finally { rmSync(staging, { recursive: true, force: true }); }
