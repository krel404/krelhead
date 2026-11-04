import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { renderTooltip, tooltipLines, tooltipMessage } from '../src/tooltip.js';
import { parseTooltip } from '../src/wowhead.js';

test('extracts readable tooltip lines, decodes entities, preserves coin units, and strips scripts', () => {
  const lines = tooltipLines('<b>Name &amp; more</b><br><span class="q2">Equip: +5</span><div>Price: <span class="moneygold">2</span></div><script>evil()</script>');
  assert.deepEqual(lines.map(l => l.text), ['Name & more', 'Equip: +5', 'Price: 2g']);
  assert.equal(lines[1]?.color, '#1eff00');
});

test('renders source text safely into a bounded PNG and builds a Discord attachment', async () => {
  const tooltip = { type: 'item' as const, id: 19019, name: 'Name <&> "test"', quality: 5,
    html: '<b>Name &lt;&amp;&gt; "test"</b><br>Requires Level 60' };
  const png = await renderTooltip(tooltip);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 680);
  assert(metadata.height! > 80 && metadata.height! < 200);
  const message = await tooltipMessage(tooltip);
  assert.equal(message.files.length, 1);
  const embed = message.embeds[0]!.toJSON();
  assert.equal(embed.url, 'https://www.wowhead.com/forever/item=19019');
  assert.equal(embed.image?.url, 'attachment://tooltip.png');
});

test('renders all captured source types', async () => {
  for (const type of ['item', 'npc', 'spell', 'quest'] as const) {
    const value = JSON.parse(readFileSync(new URL(`fixtures/${type}.json`, import.meta.url), 'utf8'));
    const tooltip = parseTooltip(value, { type, id: 1 });
    const png = await renderTooltip(tooltip);
    assert.equal((await sharp(png).metadata()).format, 'png');
  }
});
