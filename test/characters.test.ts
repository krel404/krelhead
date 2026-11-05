import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { Characters } from '../src/characters.js';
import { SnapshotStore } from '../src/snapshots.js';

function interaction(sub: string) {
  const calls: { method: string; payload: any }[] = [];
  const raw = { commandName: 'character', guildId: 'guild', user: { id: 'owner' },
    options: { getSubcommand: () => sub, getString: () => '3/Player-1234-ABCDEF',
      getAttachment: () => ({ size: 10, url: 'https://example.com/untrusted.lua' }) },
    deferReply: async (payload: any) => { calls.push({ method: 'defer', payload }); },
    editReply: async (payload: any) => { calls.push({ method: 'edit', payload }); },
  };
  return { raw, calls, value: raw as unknown as ChatInputCommandInteraction };
}

test('character controls are private and automatic-upload configuration requires hosting', async () => {
  const store = new SnapshotStore(':memory:');
  try {
    const connect = interaction('connect');
    await assert.rejects(new Characters(store).command(connect.value), /not hosted/);
    assert.equal(connect.calls[0]?.payload.flags, MessageFlags.Ephemeral);
    const configured = new Characters(store, 'https://tome.example.com/v1/snapshots');
    const request = interaction('connect');
    await configured.command(request.value);
    const attachment = request.calls[1]!.payload.files[0];
    const config = JSON.parse(attachment.attachment.toString('utf8'));
    assert.deepEqual(store.authenticate(config.token), { guildId: 'guild', userId: 'owner' });
    assert(!request.calls[1]!.payload.content.includes(config.token));
    await configured.command(interaction('disconnect').value);
    assert.equal(store.authenticate(config.token), undefined);
  } finally { store.close(); }
});

test('manual imports reject non-Discord URLs before downloading and run without an LLM', async t => {
  let downloads = 0;
  t.mock.method(globalThis, 'fetch', async () => { downloads++; return new Response('{}'); });
  const store = new SnapshotStore(':memory:');
  try {
    const request = interaction('import');
    await assert.rejects(new Characters(store).command(request.value), /Upload the file directly/);
    assert.equal(downloads, 0);
    request.raw.options.getAttachment = () => ({ size: 256001, url: 'https://cdn.discordapp.com/attachments/test' });
    await assert.rejects(new Characters(store).command(request.value), /256 KB/);
    assert.equal(downloads, 0);
    const list = interaction('list');
    await new Characters(store).command(list.value);
    assert.match(list.calls[1]!.payload.content, /No characters linked/);
  } finally { store.close(); }
});

test('Discord attachment import saves a snapshot under the authenticated member and server', async t => {
  const payload = { schemaVersion: 1, addonVersion: '0.1.0', capturedAt: 1700000000,
    game: { version: '1.60.1', build: '70755', interface: 16001, region: 3 },
    character: { guid: 'Player-1234-ABCDEF', name: 'Example', surname: '', realm: 'Forever PvP', classToken: 'ROGUE', raceToken: 'Orc', faction: 'Horde', level: 25 },
    equipment: Array.from({ length: 19 }, (_, i) => ({ slot: i + 1, status: 'empty' })), talents: { status: 'unavailable', nodes: [] } };
  t.mock.method(globalThis, 'fetch', async (_url: URL, options: RequestInit) => {
    assert.equal(options.redirect, 'error'); return new Response(JSON.stringify(payload));
  });
  const store = new SnapshotStore(':memory:');
  try {
    const request = interaction('import');
    request.raw.options.getAttachment = () => ({ size: 5000, url: 'https://cdn.discordapp.com/attachments/123/456/TomeSnapshot.lua' });
    await new Characters(store).command(request.value);
    assert.equal(store.list('guild', '', 'owner')[0]?.level, 25);
    assert.equal(store.list('guild', '', 'someone-else').length, 0);
    assert.match(request.calls[1]!.payload.content, /shared with this server/);
  } finally { store.close(); }
});

test('forget binds deletion to the invoking member, revokes their token and clears context only after removal', async () => {
  const received: unknown[] = [];
  const store = { forget: (...args: unknown[]) => { received.push(args); return true; }, revoke: (owner: unknown) => received.push(owner) } as unknown as SnapshotStore;
  const characters = new Characters(store, undefined, guildId => received.push(guildId));
  await characters.command(interaction('forget').value);
  assert.deepEqual(received, [[{ guildId: 'guild', userId: 'owner' }, '3/Player-1234-ABCDEF'], { guildId: 'guild', userId: 'owner' }, 'guild']);
});
