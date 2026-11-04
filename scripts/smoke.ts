import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Wowhead } from '../src/wowhead.js';
import { renderTooltip } from '../src/tooltip.js';
import { type EntityType } from '../src/model.js';

const source = new Wowhead();
await mkdir('artifacts', { recursive: true });
for (const [type, query, id] of [
  ['item', 'Thunderfury', 19019], ['npc', 'Hogger', 448], ['spell', 'Frostbolt', 116], ['quest', 'Hogger', 176],
] as [EntityType, string, number][]) {
  const results = await source.search(query, type);
  assert(results.length > 0, `No ${type} search results`);
  assert(results.every(result => result.type === type));
  const tooltip = await source.tooltip({ type, id });
  const png = await renderTooltip(tooltip);
  await writeFile(`artifacts/${type}.png`, png);
  console.log(`${type}: ${results.length} search results; #${id} ${tooltip.name}; PNG ${png.length} bytes`);
}
assert.equal((await source.search('zzzzkrelheadnomatch918273645')).length, 0);
console.log('Live Forever search, all four tooltip types, PNG rendering, and empty search passed.');
