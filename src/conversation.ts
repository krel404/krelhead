import { MessageFlags, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { MemoryStore, scopeKey, type Scope } from './memory.js';
import { SettingsStore } from './settings.js';
import { Tome, answerTimeoutMs } from './tome.js';
import { tooltipMessage } from './tooltip.js';
import { messageThread } from './threads.js';
import type { SnapshotStore } from './snapshots.js';

export async function addressedToTome(message: Message, botId: string): Promise<boolean> {
  if (!message.guildId || message.author.bot || message.webhookId) return false;
  if (new RegExp(`<@!?${botId}>`).test(message.content)) return true;
  if (!message.reference?.messageId || message.reference.channelId !== message.channelId) return false;
  try { return (await message.fetchReference()).author.id === botId; }
  catch { return false; }
}

export function splitAnswer(text: string): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest && parts.length < 4) {
    if (rest.length <= 1900) { parts.push(rest); break; }
    let end = rest.lastIndexOf('\n', 1900);
    if (end < 500) end = rest.lastIndexOf(' ', 1900);
    if (end < 500) end = 1900;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end).trim();
    if (parts.length === 4 && rest) parts[3] = parts[3]!.slice(0, 1800) + '\n…Ask me to focus on a smaller part for more detail.';
  }
  return parts;
}

export class Conversation {
  private active = new Set<string>();
  private seen = new Map<string, number>();
  private limits = new Map<string, { count: number; expires: number }>();

  constructor(private tome: Tome, private memory: MemoryStore, private settings: SettingsStore, private snapshots?: SnapshotStore) {}

  async handle(message: Message): Promise<void> {
    const botId = message.client.user?.id;
    const parentChannelId = message.channel.isThread() ? message.channel.parentId : undefined;
    if (!botId || this.settings.muted(message.guildId, message.channelId, parentChannelId) || !(await addressedToTome(message, botId))) return;
    const now = Date.now();
    for (const [id, expires] of this.seen) if (expires <= now) this.seen.delete(id);
    for (const [id, limit] of this.limits) if (limit.expires <= now) this.limits.delete(id);
    if (this.seen.has(message.id)) return;
    if (this.seen.size >= 5000) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(message.id, now + 10 * 60_000);
    // Resolve delivery before calling the model. Never fall back to the main channel.
    const thread = await messageThread(message);
    const muted = () => this.settings.muted(message.guildId, thread.id, thread.parentId);
    if (muted()) return;
    const scope: Scope = { guildId: message.guildId!, channelId: thread.id, userId: message.author.id };
    const key = scopeKey(scope);
    const budgetKey = `${scope.guildId}:${scope.userId}`;
    const limit = this.limits.get(budgetKey);
    const reply = (content: string) => thread.send({ content, flags: MessageFlags.SuppressEmbeds,
      allowedMentions: { parse: [], repliedUser: false } });
    if (this.active.has(key)) { await reply('I’m still working on your previous question here.'); return; }
    if (this.active.size >= 3 || (limit && limit.count >= 5)) { await reply('I’m at my request limit for the moment. Try again in a minute.'); return; }
    const question = message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
    if (!question) { await reply('Hi! Ask me a question, or try `/help`. I read text questions for now.'); return; }
    if (question.length > 4000) { await reply('Please keep the question under 4,000 characters.'); return; }
    this.limits.set(budgetKey, { count: (limit?.count ?? 0) + 1, expires: limit?.expires ?? now + 60_000 });
    this.active.add(key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), answerTimeoutMs);
    const typing = () => { void thread.sendTyping().catch(() => {}); };
    typing();
    const interval = setInterval(typing, 8000);
    try {
      let replyTo: string | undefined;
      if (message.reference?.messageId && message.reference.channelId === message.channelId) {
        const parent = await message.fetchReference().catch(() => null);
        if (parent?.author.id === botId) replyTo = [parent.content,
          ...parent.embeds.map(embed => [embed.title, embed.description, embed.url].filter(Boolean).join('\n'))].join('\n').slice(0, 4000);
      }
      const result = await this.tome.answer(question, {
        requestId: message.id,
        history: this.memory.history(scope), facts: this.memory.list(scope),
        guildDefaults: this.memory.guildDefaults(scope.guildId), replyTo,
        characters: async query => this.snapshots ? { characters: this.snapshots.list(scope.guildId, query, query ? undefined : scope.userId),
          coverage: 'Up to 25 player-uploaded characters shared with this server. Empty query lists the requesting member’s characters.' } : { error: 'Character snapshots are not connected.' },
        character: async id => this.snapshots?.get(scope.guildId, id) ?? { error: 'Character snapshots are not connected.' },
        members: async query => {
          if (!message.guild) return { error: 'Guild unavailable.' };
          // Discord search is prefix-based; the list endpoint is a paginated sample.
          const found = query ? await message.guild.members.search({ query, limit: 25, cache: false })
            : await message.guild.members.list({ limit: 25, cache: false });
          return { totalDiscordMembers: message.guild.memberCount, coverage: 'Up to 25 Discord members; not a complete roster or verified game characters.',
            members: found.map(member => ({ id: member.id, name: member.displayName, username: member.user.username,
              bot: member.user.bot, roles: member.roles.cache.filter(role => role.id !== message.guildId).map(role => role.name) })) };
        },
      }, controller.signal);
      // Muting during a request also prevents delivery.
      if (muted()) return;
      const parts = splitAnswer(result.text);
      await reply(parts[0] ?? 'Here’s what I found.');
      // Suppress link previews in prose, while keeping intentional tooltip cards visible.
      if (result.tooltip) await thread.send({ ...await tooltipMessage(result.tooltip), allowedMentions: { parse: [], repliedUser: false } });
      for (const part of parts.slice(1)) await reply(part);
      this.memory.append(scope, question, parts.join('\n'));
    } catch (error) {
      console.error('Tome conversation failed:', error instanceof Error ? error.name : 'UnknownError');
      if (!muted()) await reply('I couldn’t complete that request right now. Please try again; the slash-command lookups are also available.').catch(() => {});
    } finally {
      clearTimeout(timeout); clearInterval(interval); this.active.delete(key);
    }
  }

  async command(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!['remember', 'memories', 'forget', 'resetcontext'].includes(interaction.commandName)) return false;
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Use memory commands in a server channel.', flags: MessageFlags.Ephemeral }); return true;
    }
    const scope = { guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user.id };
    if (this.active.has(scopeKey(scope))) {
      await interaction.reply({ content: 'Please wait for my current answer here before changing memory.', flags: MessageFlags.Ephemeral }); return true;
    }
    let content: string;
    switch (interaction.commandName) {
      case 'remember': {
        const saved = this.memory.save(scope, interaction.options.getString('fact', true));
        content = `Saved for you in this channel. This fact can inform my public replies here.\nID: \`${saved.id}\`\nUse /forget to remove it.`;
        break;
      }
      case 'memories': {
        const rows = this.memory.list(scope);
        const lines = rows.map(row => `\`${row.id}\` — ${row.fact}`);
        const chunks: string[] = [];
        for (let i = 0; i < lines.length; i += 4) chunks.push(lines.slice(i, i + 4).join('\n'));
        if (!chunks.length) chunks.push('You have no saved facts in this channel.');
        await interaction.reply({ content: chunks[0], flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds, allowedMentions: { parse: [] } });
        for (const chunk of chunks.slice(1)) await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds, allowedMentions: { parse: [] } });
        return true;
      }
      case 'forget': content = this.memory.forget(scope, interaction.options.getString('id', true))
        ? 'Forgot that fact and cleared your recent context here. Existing Discord messages are unchanged.' : 'No saved fact with that ID belongs to you in this channel.'; break;
      default: this.memory.reset(scope); content = 'Cleared your recent conversation context here. Explicitly saved facts remain.';
    }
    await interaction.reply({ content, flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds, allowedMentions: { parse: [] } });
    return true;
  }
}
