import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../src/settings.js';

test('persists settings, isolates servers, and supports channel overrides and reset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'krelhead-'));
  try {
    const path = join(dir, 'settings.json');
    const store = new SettingsStore(path);
    assert.equal(store.muted('1', '2'), false);
    store.set('1', null, true);
    assert.equal(store.muted('1', '2'), true);
    assert.equal(store.muted('3', '2'), false);
    store.set('1', '2', false);
    assert.equal(new SettingsStore(path).muted('1', '2'), false);
    store.set('1', '2', null);
    assert.equal(store.muted('1', '2'), true);
    store.set('1', null, null);
    assert.equal(store.muted('1', '2'), false);
    assert.equal(store.muted(null, null), false);
    writeFileSync(path, '{"guilds":{"1":"false"},"channels":{}}');
    assert.throws(() => new SettingsStore(path), /Invalid guilds/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
