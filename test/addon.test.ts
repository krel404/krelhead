import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { decodeSnapshot, SnapshotStore } from '../src/snapshots.js';

test('real Lua capture handles Forever events, talents, item-cache misses and safe exports into storage', () => {
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = createRequire(import.meta.url)('fengari');
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  for (const file of ['test/fixtures/snapshot-wow.lua', 'addon/TomeSnapshot/TomeSnapshot.lua', 'test/fixtures/snapshot-scenarios.lua']) {
    const status = lauxlib.luaL_dostring(state, to_luastring(readFileSync(file, 'utf8')));
    if (status !== lua.LUA_OK) assert.fail(to_jsstring(lua.lua_tostring(state, -1)));
  }
  const value = (name: string): string => {
    lua.lua_getglobal(state, to_luastring(name));
    const text = to_jsstring(lua.lua_tostring(state, -1));
    lua.lua_pop(state, 1);
    return text;
  };
  const baseline = decodeSnapshot(value('TestBaseline'));
  assert.equal(baseline.character.level, 25);
  assert.equal(baseline.character.surname, 'Surname');
  assert.equal(baseline.character.realm, 'Forever PvP');
  assert.equal(baseline.equipment[15]?.itemString, 'item:12345:15:0:0:0:0:-9:42');
  assert.equal(baseline.talents.nodes[0]?.rank, 3);
  assert.equal(baseline.talents.nodes[0]?.spellId, 14162);
  assert.equal(decodeSnapshot(value('TestCacheMiss')).equipment[15]?.itemString, baseline.equipment[15]?.itemString);
  assert.equal(decodeSnapshot(value('TestStaged')).talents.status, 'pending');
  assert.equal(decodeSnapshot(value('TestMissingTalents')).talents.status, 'unavailable');
  assert.deepEqual(decodeSnapshot(value('TestUnequipped')).equipment[15], { slot: 16, status: 'empty' });
  const store = new SnapshotStore(':memory:');
  try {
    store.ingest({ guildId: 'guild', userId: 'owner' }, `\nTomeSnapshotExport = "${value('TestBaseline')}"\n`);
    assert.equal(store.list('guild', '', 'owner')[0]?.level, 25);
    assert.equal(store.get('guild', '3/Player-1234-ABCDEF').snapshot?.talents.nodes[0]?.spellId, 14162);
  } finally { store.close(); lua.lua_close(state); }
});
