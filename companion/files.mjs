import { readdir, lstat, realpath, mkdir, copyFile, access } from 'node:fs/promises';
import { basename, join, resolve, relative, isAbsolute } from 'node:path';

const exists = async path => { try { await access(path); return true; } catch { return false; } };
const isLink = async path => { try { return (await lstat(path)).isSymbolicLink(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
async function directories(path) {
  try { return (await readdir(path, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function foreverRoot(selected) {
  const root = basename(selected) === '_forever_' ? resolve(selected) : join(resolve(selected), '_forever_');
  if (!await exists(join(root, 'Interface')) || (await lstat(root)).isSymbolicLink()) {
    throw new Error('Choose your World of Warcraft folder, or the _forever_ folder inside it.');
  }
  return realpath(root);
}

export async function defaultInstallations(platform = process.platform, env = process.env) {
  const bases = platform === 'darwin' ? ['/Applications/World of Warcraft'] : platform === 'win32'
    ? [join(env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'World of Warcraft'), join(env.ProgramFiles || 'C:/Program Files', 'World of Warcraft'), 'C:/Games/World of Warcraft'] : [];
  const found = [];
  for (const base of bases) { try { found.push(await foreverRoot(base)); } catch { /* Browse handles custom installations. */ } }
  return [...new Set(found)];
}

export async function accounts(root) {
  root = await foreverRoot(root);
  const path = join(root, 'WTF', 'Account');
  if (!await exists(path)) return [];
  const inside = relative(root, await realpath(path));
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Choose an installation whose WTF folder is inside the game folder.');
  return directories(path);
}

export async function discoverSnapshots(root, account) {
  if (!account || account === '.' || account === '..' || /[\\/\x00-\x1f]/.test(account)) throw new Error('Choose a WoW account.');
  const accountRoot = join(await foreverRoot(root), 'WTF', 'Account', account);
  if (!(await accounts(root)).includes(account)) return [];
  const files = [];
  for (const realm of await directories(accountRoot)) {
    if (realm === 'SavedVariables') continue;
    for (const character of await directories(join(accountRoot, realm))) {
      const saved = join(accountRoot, realm, character, 'SavedVariables');
      try {
        if (!(await lstat(saved)).isDirectory() || (await lstat(saved)).isSymbolicLink()) continue;
        const file = join(saved, 'TomeSnapshot.lua');
        const info = await lstat(file);
        if (info.isFile() && !info.isSymbolicLink()) files.push(file);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return files.sort();
}

export async function installAddon(root, source) {
  root = await foreverRoot(root);
  // Only replace the two files we ship. Never remove another addon or saved player data.
  const paths = [join(root, 'Interface'), join(root, 'Interface', 'AddOns'), join(root, 'Interface', 'AddOns', 'TomeSnapshot')];
  for (const path of paths) {
    if (await isLink(path)) throw new Error('The addon destination is a symbolic link. Install the addon manually.');
    await mkdir(path, { recursive: true });
  }
  for (const name of ['TomeSnapshot.lua', 'TomeSnapshot.toc']) {
    const destination = join(paths.at(-1), name);
    if (await isLink(destination)) throw new Error('The addon file is a symbolic link. Install the addon manually.');
    await copyFile(join(source, name), destination);
  }
}
