import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore } from '../src/memory.js';
import { memoryDatabasePath } from '../src/migrations.js';

test('memory rename preserves facts and guild defaults, creates a backup, and is idempotent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tome-migration-'));
  const oldPath = join(directory, 'syl.sqlite');
  const scope = { guildId: 'guild', channelId: 'channel', userId: 'member' };
  const old = new MemoryStore(oldPath);
  const saved = old.save(scope, 'I play a rogue.');
  old.setGuildDefaults('guild', { faction: 'Horde', focus: 'PvP' }); old.close();
  // Exercise consolidation of a database configured for WAL as well as the current default mode.
  const wal = new DatabaseSync(oldPath); wal.exec('PRAGMA journal_mode = WAL'); wal.close();
  try {
    const path = memoryDatabasePath(directory);
    assert.equal(path, join(directory, 'tome.sqlite'));
    assert(!existsSync(oldPath));
    assert(existsSync(`${path}.pre-rename.bak`));
    const current = new MemoryStore(path);
    try {
      assert.deepEqual(current.list(scope).map(row => ({ ...row })), [saved]);
      assert.deepEqual(current.guildDefaults('guild'), { faction: 'Horde', focus: 'PvP' });
    } finally { current.close(); }
    assert.equal(memoryDatabasePath(directory), path);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('memory migration refuses to overwrite an existing database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tome-duplicate-'));
  try {
    new MemoryStore(join(directory, 'syl.sqlite')).close();
    new MemoryStore(join(directory, 'tome.sqlite')).close();
    assert.throws(() => memoryDatabasePath(directory), /neither was modified/);
    assert(existsSync(join(directory, 'syl.sqlite')));
    assert(existsSync(join(directory, 'tome.sqlite')));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
