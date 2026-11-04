import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import sharp from 'sharp';
import { AttachmentBuilder, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { entityUrl, labels, type Tooltip } from './model.js';

const qualityColors = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80', '#00ccff'];
type Line = { text: string; color: string };

export function tooltipLines(html: string): Line[] {
  const $ = load(html);
  $('script,style,iframe,img').remove();
  // Keep coin denominations, which Wowhead normally displays as background images.
  for (const [cls, unit] of [['moneygold', 'g'], ['moneysilver', 's'], ['moneycopper', 'c']]) {
    $(`.${cls}`).append(unit!);
  }
  const lines: Line[] = [];
  let text = '';
  let color = '#eeeeee';
  const flush = () => {
    const value = text.replace(/\s+/g, ' ').trim();
    if (value) lines.push({ text: value, color });
    text = ''; color = '#eeeeee';
  };
  const walk = (node: AnyNode | undefined, inherited = '#eeeeee') => {
    if (!node) return;
    if (node.type === 'text') {
      if (!text.trim()) color = inherited;
      text += node.data;
      return;
    }
    if (node.type !== 'tag' && node.type !== 'root') return;
    const tag = node.type === 'tag' ? node.name : '';
    const boundary = ['br', 'tr', 'div', 'p', 'table'].includes(tag);
    if (boundary) flush();
    let nextColor = inherited;
    if (node.type === 'tag') {
      const cls = (node.attribs.class ?? '').split(/\s+/);
      const quality = cls.find(c => /^q[0-7]$/.test(c));
      if (quality) nextColor = qualityColors[Number(quality[1])]!;
      else if (cls.includes('q')) nextColor = '#ffd100';
    }
    for (const child of node.children) walk(child, nextColor);
    if (['td', 'th'].includes(tag)) text += '   ';
    if (boundary && tag !== 'br') flush();
  };
  walk($.root()[0]);
  flush();
  return lines;
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function wrap(text: string, max = 65): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length + 1 > max && line) { lines.push(line); line = ''; }
    // Prevent unbroken source strings from overflowing the card.
    for (let i = 0; i < word.length; i += max) {
      const piece = word.slice(i, i + max);
      line = line ? `${line} ${piece}` : piece;
      if (i + max < word.length) { lines.push(line); line = ''; }
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderTooltip(tooltip: Tooltip): Promise<Buffer> {
  const color = qualityColors[tooltip.quality ?? -1] ?? '#ffd100';
  const title = wrap(tooltip.name, 49);
  const body = tooltipLines(tooltip.html).map((line, i) => i === 0 && line.text.startsWith(tooltip.name)
    ? { ...line, text: line.text.slice(tooltip.name.length).trim() } : line).filter(line => line.text)
    .flatMap(line => wrap(line.text).map(text => ({ text, color: line.color })));
  const visible = body.slice(0, 65);
  if (body.length > visible.length) visible.push({ text: 'More details on Wowhead →', color: '#ffd100' });
  let y = 38;
  const elements = title.map(line => {
    const result = `<text x="24" y="${y}" fill="${color}" font-size="22" font-weight="700">${xml(line)}</text>`;
    y += 28;
    return result;
  });
  y += 8;
  for (const line of visible) {
    elements.push(`<text x="24" y="${y}" fill="${line.color}" font-size="17">${xml(line.text)}</text>`);
    y += 24;
  }
  y += 15;
  elements.push(`<text x="24" y="${y}" fill="#a5a5b4" font-size="13">WoW Forever · ${labels[tooltip.type]} #${tooltip.id} · Data: Wowhead</text>`);
  const height = y + 23;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="${height}">
    <rect x="1" y="1" width="678" height="${height - 2}" rx="10" fill="#101020" stroke="#a39774" stroke-width="2"/>
    <g font-family="Arial, DejaVu Sans, sans-serif">${elements.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function tooltipMessage(tooltip: Tooltip) {
  const embed = new EmbedBuilder()
    .setTitle(tooltip.name.slice(0, 256)).setURL(entityUrl(tooltip))
    .setColor(qualityColors[tooltip.quality ?? -1] as `#${string}` ?? '#d4aa57')
    .setFooter({ text: `WoW Forever • ${labels[tooltip.type]} #${tooltip.id} • Data: Wowhead • Forever data may be incomplete` });
  if (tooltip.icon) embed.setThumbnail(`https://wow.zamimg.com/images/wow/icons/large/${tooltip.icon.toLowerCase()}.jpg`);
  try {
    const png = await renderTooltip(tooltip);
    embed.setImage('attachment://tooltip.png');
    return { embeds: [embed], files: [new AttachmentBuilder(png, { name: 'tooltip.png' })], allowedMentions: { parse: [] as never[] } };
  } catch (error) {
    console.error('Tooltip image failed; using text.', error instanceof Error ? error.message : 'Unknown error');
    embed.setDescription(escapeMarkdown(tooltipLines(tooltip.html).map(l => l.text).join('\n')).slice(0, 4000));
    return { embeds: [embed], files: [], allowedMentions: { parse: [] as never[] } };
  }
}
