import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { decodeSnapshot, SnapshotStore, type Snapshot } from '../src/snapshots.js';
import { snapshotServer } from '../src/snapshot-api.js';

export function fixture(): Snapshot {
  return { schemaVersion: 1, addonVersion: '0.1.0', capturedAt: 1700000000,
    game: { version: '1.60.1', build: '70755', interface: 16001, region: 3 },
    character: { guid: 'Player-1234-ABCDEF', name: 'Example', surname: '', realm: 'Forever PvP', classToken: 'ROGUE', raceToken: 'Orc', faction: 'Horde', level: 25 },
    equipment: Array.from({ length: 19 }, (_, i) => ({ slot: i + 1, status: 'empty' })), talents: { status: 'complete', configId: 123, nodes: [] } };
}
const owner = { guildId: 'guild', userId: 'member' };
test('snapshot parser accepts only data, rejects wrong versions, forged fields and unsafe payloads', () => {
  const input = fixture();
  assert.deepEqual(decodeSnapshot(JSON.stringify(input)), input);
  assert.deepEqual(decodeSnapshot(`TomeSnapshotExport = "TOME1:${Buffer.from(JSON.stringify(input)).toString('hex')}"`), input);
  // Old installed addons and files remain importable after the rename.
  const legacy = `SYL1:${Buffer.from(JSON.stringify(input)).toString('hex')}`;
  assert.deepEqual(decodeSnapshot(legacy), input);
  assert.deepEqual(decodeSnapshot(`SylSnapshotExport = "${legacy}"`), input);
  for (const payload of ['os.execute("bad")', 'TomeSnapshotExport = "TOME1:7b7d"; os.execute("bad")', 'TOME1:abc', 'x'.repeat(256001), '{"schemaVersion":99}']) {
    assert.throws(() => decodeSnapshot(payload));
  }
  for (const mutate of [
    (s: Snapshot) => { s.game.interface = 120000; },
    (s: Snapshot) => { s.capturedAt = Math.floor(Date.now() / 1000) + 3600; },
    (s: Snapshot) => { s.equipment[1]!.slot = 1; },
    (s: Snapshot) => { s.equipment[0] = { slot: 1, status: 'equipped', itemId: 1, itemString: 'item:2:0' }; },
    (s: Snapshot) => { s.character.level = -1; },
  ]) { const s = fixture(); mutate(s); assert.throws(() => decodeSnapshot(JSON.stringify(s))); }
  assert(!JSON.stringify(decodeSnapshot(JSON.stringify({ ...input, botToken: 'not-allowed' }))).includes('botToken'));
});

test('snapshots persist, isolate servers/owners, reject old replacements and bound history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tome-snapshots-'));
  const path = join(directory, 'characters.sqlite');
  let store = new SnapshotStore(path);
  try {
    const input = fixture();
    const saved = store.ingest(owner, JSON.stringify(input));
    assert.equal(saved.status, 'saved');
    assert.equal(store.ingest(owner, JSON.stringify(input)).status, 'unchanged');
    assert.throws(() => store.ingest({ ...owner, userId: 'other' }, JSON.stringify(input)), /another Discord member/);
    assert.equal(store.list('different').length, 0);
    assert.equal(store.list('guild', '', 'other').length, 0);
    assert.equal(store.list('guild', 'Exam')[0]?.ownerDiscordId, 'member');
    assert.equal(store.list('guild', '%').length, 0);
    for (let i = 1; i < 30; i++) { input.capturedAt++; input.character.level = 26; store.ingest(owner, JSON.stringify(input)); }
    const inspection = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(inspection.prepare('SELECT COUNT(*) AS count FROM snapshots').get()?.count, 20); }
    finally { inspection.close(); }
    store.ingest(owner, JSON.stringify(fixture()));
    assert.equal(store.get('guild', saved.characterId).snapshot?.character.level, 26);
    assert.equal(store.get('guild', saved.characterId).stale, true);
    assert.equal(store.get('other', saved.characterId).snapshot, undefined);
    store.close(); store = new SnapshotStore(path);
    assert.equal(store.list('guild').length, 1);
    assert.equal(store.forget({ ...owner, userId: 'other' }, saved.characterId), false);
    assert.equal(store.forget(owner, saved.characterId), true);
    assert.equal(store.list('guild').length, 0);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('upload tokens are hashed, scoped, rotated, revocable and expire', () => {
  let now = Date.now();
  const directory = mkdtempSync(join(tmpdir(), 'tome-tokens-'));
  const path = join(directory, 'characters.sqlite');
  const store = new SnapshotStore(path, () => now);
  try {
    const token = store.issueToken(owner);
    assert(!readFileSync(path).includes(Buffer.from(token)));
    assert.deepEqual(store.authenticate(token), owner);
    const second = store.issueToken(owner);
    assert.equal(store.authenticate(token), undefined);
    assert.deepEqual(store.authenticate(second), owner);
    store.revoke(owner); assert.equal(store.authenticate(second), undefined);
    const expired = store.issueToken(owner); now += 91 * 24 * 3600_000;
    assert.equal(store.authenticate(expired), undefined);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('desktop upload to authenticated API persists a snapshot, deduplicates, and enforces membership/revocation', async () => {
  // The player companion is deliberately standalone JavaScript, shipped without the bot's dependencies.
  const { validateConfig, uploadFile } = await import('../uploader/tome-uploader.mjs' as string);
  const store = new SnapshotStore(':memory:');
  let member = true;
  const server = snapshotServer(store, async () => member);
  const directory = mkdtempSync(join(tmpdir(), 'tome-upload-'));
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address() as { port: number };
    const endpoint = `http://127.0.0.1:${address.port}/v1/snapshots`;
    const token = store.issueToken(owner);
    const file = join(directory, 'TomeSnapshot.lua');
    writeFileSync(file, `TomeSnapshotExport = "TOME1:${Buffer.from(JSON.stringify(fixture())).toString('hex')}"`);
    const config = validateConfig({ endpoint, token, files: [file] });
    assert.throws(() => validateConfig({ ...config, endpoint: 'http://example.com/v1/snapshots' }));
    assert.throws(() => validateConfig({ ...config, endpoint: 'https://example.com/v1/snapshots?token=secret' }));
    assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 401);
    const digest = await uploadFile(config, file);
    assert.equal(store.list('guild', '', 'member').length, 1);
    assert.equal(await uploadFile(config, file, digest), digest);
    member = false;
    await assert.rejects(uploadFile(config, file), /403/);
    member = true;
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'x'.repeat(256001) })).status, 413);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'os.execute("bad")' })).status, 400);
    for (let i = 0; i < 10; i++) await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' });
    const limited = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
    store.revoke(owner); await assert.rejects(uploadFile(config, file), /401/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
