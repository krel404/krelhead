import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChannelType, MessageFlags, PermissionFlagsBits, type Interaction } from 'discord.js';
import { Bot } from '../src/bot.js';
import { commands } from '../src/commands.js';
import { SettingsStore } from '../src/settings.js';
import { Wowhead } from '../src/wowhead.js';
import { SourceError } from '../src/model.js';

function interaction(commandName: string, options: Record<string, string> = {}) {
  const calls: { method: string; payload: any }[] = [];
  const input = {
    commandName, guildId: '1', channelId: '2', user: { id: '3' },
    channel: { id: '2', parentId: 'parent', isThread: () => true,
      send: async (payload: any) => { calls.push({ method: 'threadSend', payload }); return { url: 'https://discord.com/channels/1/2/4' }; } },
    memberPermissions: { has: (_permission: bigint) => false },
    options: { getString: (key: string) => options[key] ?? null, getFocused: () => options.query ?? '' },
    deferred: false, replied: false, responded: false,
    isAutocomplete: () => false, isStringSelectMenu: () => false, isChatInputCommand: () => true,
    isMessageComponent: () => false, isRepliable: () => true,
    reply: async (payload: any) => { input.replied = true; calls.push({ method: 'reply', payload }); },
    deferReply: async (payload: any) => { input.deferred = true; calls.push({ method: 'deferReply', payload }); },
    deferUpdate: async () => { input.deferred = true; calls.push({ method: 'deferUpdate', payload: null }); },
    editReply: async (payload: any) => { calls.push({ method: 'editReply', payload }); },
    followUp: async (payload: any) => { calls.push({ method: 'followUp', payload }); },
    respond: async (payload: any) => { input.responded = true; calls.push({ method: 'respond', payload }); },
    customId: '', values: [] as string[],
  };
  return { input, calls, value: input as unknown as Interaction };
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'krelhead-bot-'));
  const settings = new SettingsStore(join(dir, 'settings.json'));
  let searches = 0;
  const source = {
    search: async () => { searches++; return [
      { type: 'npc', id: 448, name: 'Hogger', popularity: 2 },
      { type: 'npc', id: 278256, name: 'Super Hogger', popularity: 1 },
    ]; },
    tooltip: async (ref: { type: string; id: number }) => ({ ...ref, name: 'Hogger', html: '<b>Hogger</b><br>Level 11' }),
  };
  return { bot: new Bot(source as unknown as Wowhead, settings), settings, source,
    searches: () => searches, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('all command definitions serialize with valid descriptions and query autocomplete', () => {
  const schemas = commands.map(command => command.toJSON());
  assert.equal(schemas.length, 14);
  assert.equal(new Set(schemas.map(s => s.name)).size, 14);
  assert(schemas.every(s => s.description.length <= 100));
});

test('setup checks scope-specific permissions before writing and muted lookups avoid the source', async () => {
  const h = harness();
  try {
    const denied = interaction('setup', { scope: 'server', mode: 'muted' });
    await h.bot.handle(denied.value);
    assert.match(denied.calls[0]!.payload.content, /Manage Server/);
    assert.equal(h.settings.muted('1', '2'), false);
    const allowed = interaction('setup', { scope: 'channel', mode: 'muted' });
    allowed.input.memberPermissions.has = permission => permission === PermissionFlagsBits.ManageChannels;
    await h.bot.handle(allowed.value);
    assert.equal(h.settings.muted('1', '2'), true);
    const lookup = interaction('npc', { query: 'Hogger' });
    await h.bot.handle(lookup.value);
    assert.equal(lookup.calls[0]!.payload.flags, MessageFlags.Ephemeral);
    assert.equal(h.searches(), 0);
  } finally { h.cleanup(); }
});

test('search defers before fetching, returns an image, and only its owner can change matches', async () => {
  const h = harness();
  try {
    const search = interaction('search', { query: 'Hogger' });
    await h.bot.handle(search.value);
    assert.equal(search.calls[0]?.method, 'deferReply');
    assert.equal(search.calls[0]!.payload.flags, MessageFlags.Ephemeral);
    const payload = search.calls.find(call => call.method === 'threadSend')!.payload;
    assert.match(search.calls.at(-1)!.payload.content, /View Tome’s reply/);
    assert.equal(payload.files.length, 1);
    const customId = payload.components[0].toJSON().components[0].custom_id;
    const picker = interaction('');
    picker.input.isChatInputCommand = () => false;
    picker.input.isStringSelectMenu = () => true;
    picker.input.isMessageComponent = () => true;
    picker.input.customId = customId;
    picker.input.values = ['npc:278256'];
    picker.input.user.id = '4';
    await h.bot.handle(picker.value);
    assert.match(picker.calls[0]!.payload.content, /own \/search/);
    picker.input.user.id = '3';
    await h.bot.handle(picker.value);
    assert.equal(picker.calls.at(-1)?.method, 'editReply');
    assert.deepEqual(picker.calls.at(-1)?.payload.attachments, []);
    // Restart loses picker state but must give a useful ephemeral response.
    const expired = new Bot(h.source as unknown as Wowhead, h.settings);
    await expired.handle(picker.value);
    assert.match(picker.calls.at(-1)!.payload.content, /expired/);
  } finally { h.cleanup(); }
});

test('source failures become a user-facing error after deferral', async () => {
  const h = harness();
  try {
    h.source.search = async () => { throw new SourceError('Wowhead is temporarily unavailable.'); };
    const lookup = interaction('search', { query: 'Hogger' });
    await h.bot.handle(lookup.value);
    assert.equal(lookup.calls.at(-1)?.method, 'editReply');
    assert.match(lookup.calls.find(call => call.method === 'threadSend')!.payload.content, /temporarily unavailable/);
  } finally { h.cleanup(); }
});

test('a lookup in main chat creates a thread and acknowledges it only ephemerally', async () => {
  const h = harness();
  try {
    const lookup = interaction('npc', { query: 'Hogger' });
    let created = 0;
    let sent = 0;
    lookup.input.channel.isThread = () => false;
    lookup.input.channel.send = async () => { throw new Error('Must not send to main chat'); };
    Object.assign(lookup.input.channel, { type: ChannelType.GuildText, threads: { create: async () => {
      created++;
      return { send: async (payload: any) => { sent++; assert.equal(payload.files.length, 1); return { url: 'https://discord.com/channels/1/thread/result' }; } };
    } } });
    await h.bot.handle(lookup.value);
    assert.equal(created, 1); assert.equal(sent, 1);
    assert.equal(lookup.calls[0]!.payload.flags, MessageFlags.Ephemeral);
    assert.match(lookup.calls.at(-1)!.payload.content, /\/thread\/result/);
    assert.equal(lookup.calls.at(-1)!.payload.files, undefined);
  } finally { h.cleanup(); }
});

test('failed thread creation reports a private error without fetching data or posting a main-channel card', async () => {
  const h = harness();
  try {
    const lookup = interaction('npc', { query: 'Hogger' });
    lookup.input.channel.isThread = () => false;
    Object.assign(lookup.input.channel, { type: ChannelType.GuildText, threads: { create: async () => { throw new Error('Missing permissions'); } } });
    await h.bot.handle(lookup.value);
    assert.equal(lookup.calls[0]!.payload.flags, MessageFlags.Ephemeral);
    assert.equal(lookup.calls.at(-1)?.method, 'editReply');
    assert.equal(lookup.calls.some(call => call.method === 'threadSend'), false);
    assert.equal(h.searches(), 0);
  } finally { h.cleanup(); }
});

test('autocomplete returns typed IDs and tolerates an upstream failure', async () => {
  const h = harness();
  try {
    const input = interaction('search', { query: 'Hogger' });
    input.input.isAutocomplete = () => true;
    await h.bot.handle(input.value);
    assert.equal(input.calls[0]!.payload[0].value, 'npc:448');
    h.source.search = async () => { throw new SourceError('Unavailable'); };
    await h.bot.handle(input.value);
    assert.deepEqual(input.calls.at(-1)!.payload, []);
  } finally { h.cleanup(); }
});
