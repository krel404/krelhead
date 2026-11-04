import { ChannelType, ThreadAutoArchiveDuration, type ChatInputCommandInteraction, type Message, type ThreadChannel } from 'discord.js';
import { UserError } from './model.js';

function threadName(topic: string): string {
  return `Syl · ${topic.replace(/<[@#][^>]*>/g, '').replace(/\s+/g, ' ').trim() || 'Conversation'}`.slice(0, 100);
}

export async function messageThread(message: Message): Promise<ThreadChannel> {
  if (message.channel.isThread()) return message.channel;
  if (message.hasThread) {
    const existing = message.thread ?? await message.guild?.channels.fetch(message.id);
    if (existing?.isThread()) return existing;
    throw new UserError('The thread for this message is unavailable.');
  }
  return message.startThread({ name: threadName(message.content), autoArchiveDuration: ThreadAutoArchiveDuration.OneHour });
}

export async function commandThread(interaction: ChatInputCommandInteraction): Promise<ThreadChannel> {
  const channel = interaction.channel;
  if (channel?.isThread()) return channel;
  if (channel?.type !== ChannelType.GuildText) throw new UserError('Run this lookup in a server text channel or an existing thread.');
  return channel.threads.create({
    name: threadName(`/${interaction.commandName} ${interaction.options.getString('query') ?? ''}`),
    type: ChannelType.PublicThread, autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
  });
}
