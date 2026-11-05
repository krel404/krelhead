import test from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from 'discord.js';
import { addressedToTome, Conversation, splitAnswer } from '../src/conversation.js';
import { MemoryStore } from '../src/memory.js';
import { SettingsStore } from '../src/settings.js';
import type { Tome } from '../src/tome.js';
import type { SnapshotStore } from '../src/snapshots.js';

test('character tools bind every read to the current server and empty queries to the requesting member', async () => {
  const memory = new MemoryStore(':memory:');
  const received: unknown[] = [];
  const snapshots = { list: (...args: unknown[]) => { received.push(args); return []; }, get: (...args: unknown[]) => { received.push(args); return {}; } } as unknown as SnapshotStore;
  const tome = { answer: async (_: string, context: { characters: (query: string) => Promise<unknown>; character: (id: string) => Promise<unknown> }) => {
    await context.characters(''); await context.characters('Someone'); await context.character('3/Player-1234-ABCDEF'); return { text: 'No snapshot yet.' };
  } } as unknown as Tome;
  try {
    await new Conversation(tome, memory, { muted: () => false } as unknown as SettingsStore, snapshots).handle(message('<@123> my gear').value);
    assert.deepEqual(received, [['guild', '', 'user'], ['guild', 'Someone', undefined], ['guild', '3/Player-1234-ABCDEF']]);
  } finally { memory.close(); }
});

function message(content: string, authorId = 'user') {
  const replies: any[] = [];
  const parentReplies: unknown[] = [];
  const starts: unknown[] = [];
  const thread = { id: 'new-thread', parentId: 'channel', isThread: () => true,
    send: async (payload: unknown) => { replies.push(payload); }, sendTyping: async () => {} };
  const value = { id: 'message', content, guildId: 'guild', channelId: 'channel', author: { id: authorId, bot: false }, webhookId: null,
    client: { user: { id: '123' } }, reference: null as null | { messageId: string; channelId: string },
    fetchReference: async () => ({ author: { id: '123' }, content: 'Previous answer', embeds: [] }),
    channel: { get id(): string { return value.channelId; }, parentId: 'parent', isThread: () => true,
      send: async (payload: unknown) => { replies.push(payload); }, sendTyping: async () => {} },
    hasThread: false, thread: null as null | typeof thread,
    startThread: async (options: unknown) => { starts.push(options); return thread; },
    reply: async (payload: unknown) => { parentReplies.push(payload); } };
  return { raw: value, value: value as unknown as Message, replies, parentReplies, starts, thread };
}
test('only direct mentions and same-channel replies to Tome trigger; bots, webhooks and DMs do not', async () => {
  for (const content of ['Tome what is Frostbolt?', '<@&123> hello', 'hello']) assert.equal(await addressedToTome(message(content).value, '123'), false);
  assert.equal(await addressedToTome(message('<@123> hello').value, '123'), true);
  assert.equal(await addressedToTome(message('<@!123> hello').value, '123'), true);
  const reply = message('and rank 2?'); reply.raw.reference = { messageId: 'parent', channelId: 'channel' };
  assert.equal(await addressedToTome(reply.value, '123'), true);
  reply.raw.reference.channelId = 'other'; assert.equal(await addressedToTome(reply.value, '123'), false);
  reply.raw.reference.channelId = 'channel'; reply.raw.fetchReference = async () => ({ author: { id: 'someone' }, content: '', embeds: [] });
  assert.equal(await addressedToTome(reply.value, '123'), false);
  const bot = message('<@123> hello'); bot.raw.author.bot = true;
  assert.equal(await addressedToTome(bot.value, '123'), false);
  assert.equal(await addressedToTome({ ...message('<@123>').raw, webhookId: 'webhook' } as unknown as Message, '123'), false);
  assert.equal(await addressedToTome({ ...message('<@123>').raw, guildId: null } as unknown as Message, '123'), false);
});

test('duplicate messages, ambient chat and muted channels never cause extra model calls; mentions disabled on replies', async () => {
  const memory = new MemoryStore(':memory:');
  let requests = 0;
  let muted = false;
  const conversation = new Conversation({ answer: async () => { requests++; return { text: 'Hello!' }; } } as unknown as Tome,
    memory, { muted: () => muted } as unknown as SettingsStore);
  try {
    await conversation.handle(message('ambient').value);
    const input = message('<@123> hello');
    await conversation.handle(input.value); await conversation.handle(input.value);
    muted = true; const next = message('<@123> again'); next.raw.id = 'next'; await conversation.handle(next.value);
    assert.equal(requests, 1);
    assert.deepEqual(input.replies[0].allowedMentions, { parse: [], repliedUser: false });
    assert.equal(memory.list({ guildId: 'guild', channelId: 'channel', userId: 'user' }).length, 0);
  } finally { memory.close(); }
});

test('long answers fit Discord and have a bounded message count', () => {
  const parts = splitAnswer('a long sentence '.repeat(1500));
  assert.equal(parts.length, 4);
  assert(parts.every(part => part.length <= 1900));
  assert.match(parts[3]!, /smaller part/);
});

test('main-channel answers create a thread, keep all chunks there, and retain context for follow-ups', async () => {
  const memory = new MemoryStore(':memory:');
  const histories: unknown[] = [];
  const facts: string[][] = [];
  memory.save({ guildId: 'guild', channelId: 'channel', userId: 'user' }, 'I play a rogue.');
  const tome = { answer: async (_question: string, context: { history: unknown[]; facts: { fact: string }[] }) => {
    histories.push(context.history); facts.push(context.facts.map(row => row.fact));
    return { text: 'A sufficiently long answer. '.repeat(100) };
  } } as unknown as Tome;
  const conversation = new Conversation(tome, memory, { muted: () => false } as unknown as SettingsStore);
  try {
    const first = message('<@123> rogue gear?'); first.raw.channel.isThread = () => false;
    await conversation.handle(first.value);
    assert.equal(first.starts.length, 1);
    assert(first.replies.length > 1);
    assert.equal(first.parentReplies.length, 0);
    memory.save({ guildId: 'guild', channelId: first.thread.id, userId: 'user' }, 'Use daggers for this discussion.');
    const follow = message('what about daggers?'); follow.raw.id = 'follow'; follow.raw.channelId = first.thread.id;
    follow.raw.channel = first.thread;
    follow.raw.reference = { messageId: 'tome-answer', channelId: first.thread.id };
    await conversation.handle(follow.value);
    assert.equal(follow.starts.length, 0);
    assert.equal(follow.parentReplies.length, 0);
    assert.equal((histories[1] as unknown[]).length, 2);
    assert.deepEqual(facts, [[], ['Use daggers for this discussion.']]);
    assert.deepEqual(memory.history({ guildId: 'guild', channelId: 'channel', userId: 'user' }), []);
  } finally { memory.close(); }
});

test('existing message threads are reused and failed thread creation never falls back to main chat', async () => {
  const memory = new MemoryStore(':memory:');
  let requests = 0;
  const conversation = new Conversation({ answer: async () => { requests++; return { text: 'Answer' }; } } as unknown as Tome,
    memory, { muted: () => false } as unknown as SettingsStore);
  try {
    const existing = message('<@123> hello'); existing.raw.channel.isThread = () => false;
    existing.raw.hasThread = true; existing.raw.thread = existing.thread;
    await conversation.handle(existing.value);
    assert.equal(existing.starts.length, 0); assert.equal(existing.replies.length, 1);
    const denied = message('<@123> hello'); denied.raw.id = 'denied'; denied.raw.channel.isThread = () => false;
    denied.raw.startThread = async () => { throw new Error('Missing permissions'); };
    await assert.rejects(conversation.handle(denied.value), /Missing permissions/);
    assert.equal(requests, 1); assert.equal(denied.parentReplies.length, 0); assert.equal(denied.replies.length, 0);
  } finally { memory.close(); }
});

test('model failures are reported only inside the thread', async () => {
  const memory = new MemoryStore(':memory:');
  const conversation = new Conversation({ answer: async () => { throw new Error('Provider unavailable'); } } as unknown as Tome,
    memory, { muted: () => false } as unknown as SettingsStore);
  try {
    const input = message('<@123> hello'); input.raw.channel.isThread = () => false;
    await conversation.handle(input.value);
    assert.equal(input.parentReplies.length, 0);
    assert.match(input.replies[0].content, /couldn’t complete/);
  } finally { memory.close(); }
});

test('every member and channel receives only its own server defaults', async () => {
  const memory = new MemoryStore(':memory:');
  memory.setGuildDefaults('guild', { faction: 'Horde', focus: 'PvP' });
  const received: unknown[] = [];
  const tome = { answer: async (_question: string, context: { guildDefaults?: unknown }) => {
    received.push(context.guildDefaults); return { text: 'Answer' };
  } } as unknown as Tome;
  const conversation = new Conversation(tome, memory, { muted: () => false } as unknown as SettingsStore);
  try {
    const first = message('<@123> gear?', 'one'); await conversation.handle(first.value);
    const second = message('<@123> gear?', 'two'); second.raw.id = 'second'; second.raw.channelId = 'other-channel';
    await conversation.handle(second.value);
    const other = message('<@123> gear?', 'three'); other.raw.id = 'third'; other.raw.guildId = 'other-guild';
    await conversation.handle(other.value);
    assert.deepEqual(received, [{ faction: 'Horde', focus: 'PvP' }, { faction: 'Horde', focus: 'PvP' }, undefined]);
  } finally { memory.close(); }
});

test('one active request per member/channel and five per minute; mute during research prevents delivery', async () => {
  const memory = new MemoryStore(':memory:');
  let muted = false;
  let complete: (value: { text: string }) => void = () => {};
  let requests = 0;
  const tome = { answer: async () => { requests++; return new Promise<{ text: string }>(resolve => { complete = resolve; }); } } as unknown as Tome;
  const conversation = new Conversation(tome, memory, { muted: () => muted } as unknown as SettingsStore);
  try {
    const first = message('<@123> first');
    const pending = conversation.handle(first.value);
    await new Promise(resolve => setImmediate(resolve));
    const second = message('<@123> second'); second.raw.id = 'second';
    await conversation.handle(second.value);
    assert.match(second.replies[0].content, /previous question/);
    assert.equal(requests, 1);
    muted = true; complete({ text: 'Research answer' }); await pending;
    assert.equal(first.replies.length, 0);
    muted = false;
    for (let i = 0; i < 4; i++) {
      const next = message('<@123> hello'); next.raw.id = `next-${i}`;
      const response = conversation.handle(next.value);
      await new Promise(resolve => setImmediate(resolve));
      complete({ text: 'Hello' }); await response;
    }
    const limited = message('<@123> more'); limited.raw.id = 'limited';
    await conversation.handle(limited.value);
    assert.equal(requests, 5);
    assert.match(limited.replies[0].content, /request limit/);
  } finally { memory.close(); }
});
