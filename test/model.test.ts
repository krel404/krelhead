import test from 'node:test';
import assert from 'node:assert/strict';
import { entityUrl, parseReference, UserError } from '../src/model.js';

test('accepts names, typed IDs, type-specific IDs, and Forever URLs', () => {
  assert.equal(parseReference('Thunderfury'), undefined);
  assert.deepEqual(parseReference('ITEM:19019'), { type: 'item', id: 19019 });
  assert.deepEqual(parseReference('448', 'npc'), { type: 'npc', id: 448 });
  assert.deepEqual(parseReference('https://www.wowhead.com/forever/quest=176/wanted-hogger?foo=bar#comments'), { type: 'quest', id: 176 });
  assert.equal(entityUrl({ type: 'spell', id: 116 }), 'https://www.wowhead.com/forever/spell=116');
});

test('rejects ambiguous IDs, foreign versions, foreign hosts, and mismatched types', () => {
  for (const value of ['19019', 'item:0', 'item:99999999999999999999',
    'https://www.wowhead.com/item=19019', 'https://www.wowhead.com/classic/item=19019',
    'https://wowhead.com.evil.test/forever/item=19019', 'https://localhost/forever/item=19019',
    'https://user@www.wowhead.com/forever/item=19019']) {
    assert.throws(() => parseReference(value), UserError, value);
  }
  assert.throws(() => parseReference('npc:448', 'item'), /npc reference/);
});
