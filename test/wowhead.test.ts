import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearch, parseTooltip, Wowhead } from '../src/wowhead.js';
import { SourceError, UserError } from '../src/model.js';

const search = readFileSync(new URL('fixtures/hogger.html', import.meta.url), 'utf8');
const frostbolt = readFileSync(new URL('fixtures/frostbolt.html', import.meta.url), 'utf8');
const item = JSON.parse(readFileSync(new URL('fixtures/item.json', import.meta.url), 'utf8'));
const mockFetch = (handler: (url: string) => Promise<Response> | Response): typeof fetch =>
  (async input => handler(String(input))) as typeof fetch;

test('parses real Forever data islands, filters types, ranks exact names, and ignores unsupported types', () => {
  const all = parseSearch(search, 'Hogger');
  assert.deepEqual(all[0], { type: 'npc', id: 448, name: 'Hogger', rank: undefined, popularity: 499 });
  assert(all.some(r => r.id === 278256 && r.name === 'Super Hogger'));
  assert.equal(all.some(r => r.id === 594), false); // Achievement, outside this bot's scope.
  assert.equal(parseSearch(search, 'Hogger', 'quest')[0]?.id, 176);
  assert.deepEqual(parseSearch(search, 'Hogger', 'item'), []);
  const spells = parseSearch(frostbolt, 'Frostbolt', 'spell');
  assert(spells.length >= 25);
  assert(spells.some(r => r.rank === 'Rank 11'));
  assert.equal(new Set(spells.map(r => r.id)).size, spells.length);
});

test('distinguishes an empty search from a challenge or changed source format', () => {
  assert.deepEqual(parseSearch('<div id="search-results" class="search-no-results"></div>', 'none'), []);
  assert.throws(() => parseSearch('<html>Verify you are human</html>', 'Hogger'), SourceError);
  assert.throws(() => parseSearch(search.replace(/id="data\./g, 'id="missing.'), 'Hogger'), SourceError);
});

test('validates tooltips without executing markup', () => {
  const tooltip = parseTooltip(item, { type: 'item', id: 19019 });
  assert.equal(tooltip.quality, 5);
  assert.equal(tooltip.icon, 'inv_sword_39');
  assert.throws(() => parseTooltip({ error: 'Entity not found' }, { type: 'item', id: 1 }), UserError);
  assert.throws(() => parseTooltip({}, { type: 'item', id: 1 }), SourceError);
  assert.equal(parseTooltip({ ...item, icon: '../bad' }, { type: 'item', id: 1 }).icon, undefined);
});

test('coalesces concurrent requests, shares typed search cache, and expires it', async () => {
  let calls = 0;
  let time = 100;
  const source = new Wowhead(mockFetch(async url => {
    calls++; assert(url.startsWith('https://www.wowhead.com/forever/search?q='));
    await new Promise(resolve => setTimeout(resolve, 5));
    return new Response(search);
  }), () => time);
  const [all, npcs] = await Promise.all([source.search('Hogger'), source.search('Hogger', 'npc')]);
  assert(all.length > npcs.length);
  assert.equal(calls, 1);
  await source.search('Hogger', 'quest');
  assert.equal(calls, 1);
  time += 60_001;
  await source.search('Hogger');
  assert.equal(calls, 2);
});

test('looks up typed IDs only through the Forever tooltip endpoint', async () => {
  const urls: string[] = [];
  const source = new Wowhead(mockFetch(url => { urls.push(url); return Response.json(item); }));
  assert.equal((await source.search('19019', 'item'))[0]?.name, item.name);
  await source.tooltip({ type: 'item', id: 19019 });
  assert.deepEqual(urls, ['https://nether.wowhead.com/forever/tooltip/item/19019']);
});

test('fails clearly on HTTP errors, malformed JSON and network failure; does not cache errors', async () => {
  for (const status of [403, 429, 500, 503]) {
    const source = new Wowhead(mockFetch(() => new Response('unavailable', { status })));
    await assert.rejects(source.search('Hogger'), SourceError);
  }
  await assert.rejects(new Wowhead(mockFetch(() => new Response('', { status: 404 }))).tooltip({ type: 'npc', id: 1 }), UserError);
  await assert.rejects(new Wowhead(mockFetch(() => new Response('<html>challenge</html>'))).tooltip({ type: 'npc', id: 1 }), SourceError);
  let calls = 0;
  const source = new Wowhead(mockFetch(() => {
    if (++calls === 1) throw new Error('network down');
    return new Response(search);
  }));
  await assert.rejects(source.search('Hogger'), SourceError);
  assert((await source.search('Hogger')).length);
  assert.equal(calls, 2);
});

test('respects a source rate limit without falling back to other WoW versions', async () => {
  let time = 0; let calls = 0;
  const source = new Wowhead(mockFetch(() => {
    calls++;
    return calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '120' } }) : new Response(search);
  }), () => time);
  await assert.rejects(source.search('Hogger'), SourceError);
  time += 60_000;
  await assert.rejects(source.search('Thunderfury'), /rate limiting/);
  assert.equal(calls, 1);
  time += 60_001;
  await source.search('Hogger');
  assert.equal(calls, 2);
});

test('does not cache a challenge page and caps results after filtering their type', async () => {
  let calls = 0;
  const source = new Wowhead(mockFetch(() => new Response(++calls === 1 ? '<html>Challenge</html>' : frostbolt)));
  await assert.rejects(source.search('Frostbolt'), SourceError);
  const results = await source.search('Frostbolt', 'spell');
  assert.equal(results.length, 25);
  assert(results.every(result => result.type === 'spell'));
  assert.equal(calls, 2);
});
