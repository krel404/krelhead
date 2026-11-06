import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { foreverRoot, accounts, discoverSnapshots, installAddon } = await import('../companion/files.mjs' as string);
const { SyncSession } = await import('../companion/sync.mjs' as string);
const { validateConnection } = await import('../uploader/tome-uploader.mjs' as string);

test('companion selects one account, discovers new characters, and excludes other files and symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tome-companion-'));
  const root = join(directory, '_forever_');
  try {
    await mkdir(join(root, 'Interface', 'AddOns'), { recursive: true });
    const save = async (account: string, character: string) => {
      const folder = join(root, 'WTF', 'Account', account, 'Forever PvP', character, 'SavedVariables');
      await mkdir(folder, { recursive: true });
      const file = join(folder, 'TomeSnapshot.lua'); await writeFile(file, 'snapshot'); return realpath(file);
    };
    const first = await save('MY_ACCOUNT', 'Rogue'); await save('OTHER_ACCOUNT', 'PrivateCharacter');
    await writeFile(join(root, 'WTF', 'Account', 'MY_ACCOUNT', 'Forever PvP', 'Rogue', 'SavedVariables', 'OtherAddon.lua'), 'private');
    assert.equal(await foreverRoot(directory), await foreverRoot(root));
    assert.deepEqual(await accounts(root), ['MY_ACCOUNT', 'OTHER_ACCOUNT']);
    assert.deepEqual(await discoverSnapshots(root, 'MY_ACCOUNT'), [first]);
    const alt = await save('MY_ACCOUNT', 'Mage');
    assert.deepEqual(await discoverSnapshots(root, 'MY_ACCOUNT'), [alt, first]);
    await assert.rejects(discoverSnapshots(root, '../OTHER_ACCOUNT'), /Choose a WoW account/);
    await symlink(join(root, 'WTF', 'Account', 'OTHER_ACCOUNT'), join(root, 'WTF', 'Account', 'ALIAS'));
    assert.deepEqual(await discoverSnapshots(root, 'ALIAS'), []);
    await rm(alt); await symlink(first, alt);
    assert.deepEqual(await discoverSnapshots(root, 'MY_ACCOUNT'), [first]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('companion installs only its own addon files and never deletes another addon or player data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tome-install-'));
  const root = join(directory, '_forever_');
  const addons = join(root, 'Interface', 'AddOns');
  try {
    await mkdir(join(addons, 'OtherAddon'), { recursive: true });
    await writeFile(join(addons, 'OtherAddon', 'keep.lua'), 'untouched');
    await installAddon(root, 'addon/TomeSnapshot');
    assert.match(await readFile(join(addons, 'TomeSnapshot', 'TomeSnapshot.toc'), 'utf8'), /SavedVariablesPerCharacter/);
    assert.equal(await readFile(join(addons, 'OtherAddon', 'keep.lua'), 'utf8'), 'untouched');
    await installAddon(root, 'addon/TomeSnapshot');
    await rm(join(addons, 'TomeSnapshot'), { recursive: true });
    await symlink(join(addons, 'OtherAddon'), join(addons, 'TomeSnapshot'));
    await assert.rejects(installAddon(root, 'addon/TomeSnapshot'), /symbolic link/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('background session needs no manual capture/import, detects later files, and bounds upload rate', async () => {
  let now = 0;
  const files: string[] = [];
  const snapshots = new Map<string, string>();
  const uploads: string[] = [];
  const session = new SyncSession({ root: 'game', account: 'selected', connection: {} }, {
    now: () => now,
    discover: async (root: string, account: string) => { assert.equal(root, 'game'); assert.equal(account, 'selected'); return files; },
    read: async (file: string) => ({ body: snapshots.get(file), digest: snapshots.get(file) }),
    upload: async (_: unknown, body: string) => { uploads.push(body); },
  });
  await session.tick(); assert.equal(uploads.length, 0);
  files.push('main'); snapshots.set('main', 'first logout');
  await session.tick(); assert.deepEqual(uploads, ['first logout']);
  files.push('alt'); snapshots.set('alt', 'alt logout');
  await session.tick(); assert.equal(uploads.length, 1);
  now += 8000; await session.tick(); assert.deepEqual(uploads, ['first logout', 'alt logout']);
  now += 8000; await session.tick(); assert.equal(uploads.length, 2);
  snapshots.set('main', 'new gear after exit'); await session.tick(); assert.equal(uploads.at(-1), 'new gear after exit');
  session.stop(); now += 8000; snapshots.set('main', 'must not upload'); await session.tick(); assert.equal(uploads.length, 3);
});

test('background session retries transient failures, avoids overlapping requests, and stops on revoked credentials', async () => {
  let now = 0, attempts = 0, status = 503;
  const session = new SyncSession({ root: 'game', account: 'selected', connection: {} }, {
    now: () => now, discover: async () => ['main'], read: async () => ({ body: 'snapshot', digest: 'changed' }),
    upload: async () => { attempts++; throw Object.assign(new Error('failure'), { status }); },
  });
  await Promise.all([session.tick(), session.tick()]); assert.equal(attempts, 1);
  now = 59_000; await session.tick(); assert.equal(attempts, 1);
  now = 60_000; status = 429; await session.tick(); assert.equal(attempts, 2);
  now = 119_000; await session.tick(); assert.equal(attempts, 2);
  now = 120_000; status = 401; await session.tick(); assert.equal(attempts, 3);
  assert.equal(session.state.needsRelink, true);
  now = 200_000; await session.tick(); assert.equal(attempts, 3);
});

test('connection-file import needs no edited paths and rejects credentials in URLs and insecure remote endpoints', () => {
  const valid = { endpoint: 'https://tome.example.com/v1/snapshots', token: 'a'.repeat(64), files: ['REPLACE_WITH_FULL_PATH'] };
  assert.deepEqual(validateConnection(valid), { endpoint: valid.endpoint, token: valid.token });
  for (const endpoint of ['http://example.com/v1/snapshots', 'https://token@example.com/v1/snapshots', 'https://example.com/v1/snapshots?token=secret', 'file:///tmp/snapshot']) {
    assert.throws(() => validateConnection({ ...valid, endpoint }));
  }
});
