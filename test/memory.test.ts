import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/memory.js';

const scope = { guildId: 'guild', channelId: 'channel', userId: 'member' };
test('guild defaults persist, apply independently of member/channel facts, and do not cross servers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tome-defaults-'));
  const path = join(dir, 'facts.sqlite');
  let memory = new MemoryStore(path);
  try {
    memory.setGuildDefaults('guild', { faction: 'Horde', focus: 'PvP' });
    memory.save(scope, 'For my alt, prefer PvE.');
    memory.close(); memory = new MemoryStore(path);
    assert.deepEqual(memory.guildDefaults('guild'), { faction: 'Horde', focus: 'PvP' });
    assert.equal(memory.guildDefaults('other-guild'), undefined);
    assert.equal(memory.list(scope)[0]?.fact, 'For my alt, prefer PvE.');
    const fact = memory.list(scope)[0]!;
    memory.forget(scope, fact.id);
    assert.deepEqual(memory.guildDefaults('guild'), { faction: 'Horde', focus: 'PvP' });
    memory.setGuildDefaults('guild', { faction: 'Alliance', focus: 'PvE' });
    assert.deepEqual(memory.guildDefaults('guild'), { faction: 'Alliance', focus: 'PvE' });
  } finally { memory.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('only explicitly saved facts persist; scope and ownership apply to reads and deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tome-memory-'));
  const path = join(dir, 'facts.sqlite');
  let memory = new MemoryStore(path);
  try {
    memory.append(scope, 'I like daggers', 'Got it for this conversation.');
    assert.deepEqual(memory.list(scope), []);
    const fact = memory.save(scope, 'I play a rogue');
    for (const other of [{ ...scope, guildId: 'other' }, { ...scope, channelId: 'private' }, { ...scope, userId: 'other' }]) {
      assert.deepEqual(memory.list(other), []);
      assert.equal(memory.forget(other, fact.id), false);
      assert.deepEqual(memory.history(other), []);
    }
    memory.close(); memory = new MemoryStore(path);
    assert.equal(memory.list(scope)[0]?.fact, 'I play a rogue');
    assert.deepEqual(memory.history(scope), []);
    memory.append(scope, 'What do I play?', 'A rogue');
    assert.equal(memory.forget(scope, fact.id), true);
    assert.deepEqual(memory.list(scope), []);
    assert.deepEqual(memory.history(scope), []);
  } finally { memory.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('recent context is bounded and expires; facts have explicit size and count limits', () => {
  let now = 100;
  const memory = new MemoryStore(':memory:', () => now);
  try {
    for (let i = 0; i < 10; i++) memory.append(scope, `question ${i}`, `answer ${i}`);
    assert.equal(memory.history(scope).length, 12);
    now += 30 * 60_000;
    assert.deepEqual(memory.history(scope), []);
    assert.throws(() => memory.save(scope, ' '.repeat(3)));
    assert.throws(() => memory.save(scope, 'a'.repeat(401)));
    for (let i = 0; i < 20; i++) memory.save(scope, `fact ${i}`);
    assert.throws(() => memory.save(scope, 'one more'));
  } finally { memory.close(); }
});
