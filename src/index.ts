import { resolve } from 'node:path';
import { ApplicationFlagsBitField, Client, Events, GatewayIntentBits, Options, REST, Routes, type RESTGetAPIOAuth2CurrentApplicationResult } from 'discord.js';
import { Bot } from './bot.js';
import { required } from './config.js';
import { SettingsStore } from './settings.js';
import { Wowhead } from './wowhead.js';
import OpenAI from 'openai';
import { MemoryStore } from './memory.js';
import { Conversation } from './conversation.js';
import { Syl, defaultModel, defaultResearchModel } from './syl.js';

const token = required('DISCORD_TOKEN');
const enabled = Boolean(process.env.OPENAI_API_KEY?.trim());
if (enabled) {
  const application = await new REST({ version: '10' }).setToken(token).get(Routes.oauth2CurrentApplication()) as RESTGetAPIOAuth2CurrentApplicationResult;
  const flags = new ApplicationFlagsBitField(application.flags);
  if (!(flags.has('GatewayMessageContent') || flags.has('GatewayMessageContentLimited')) ||
      !(flags.has('GatewayGuildMembers') || flags.has('GatewayGuildMembersLimited'))) {
    throw new Error(`Enable Message Content Intent and Server Members Intent before starting Syl: https://discord.com/developers/applications/${application.id}/bot`);
  }
}
const client = new Client({ intents: [GatewayIntentBits.Guilds,
  ...(enabled ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] : [])],
  allowedMentions: { parse: [], repliedUser: false }, makeCache: Options.cacheWithLimits({ MessageManager: 0 }) });
const source = new Wowhead();
const settings = new SettingsStore(resolve(process.env.DATA_DIR ?? 'data', 'settings.json'));
const memory = new MemoryStore(resolve(process.env.DATA_DIR ?? 'data', 'syl.sqlite'));
const model = process.env.OPENAI_MODEL?.trim() || defaultModel;
const researchModel = process.env.OPENAI_RESEARCH_MODEL?.trim() || defaultResearchModel;
const conversation = enabled ? new Conversation(new Syl(new OpenAI({ timeout: 60_000, maxRetries: 0 }), source, model, researchModel), memory, settings) : undefined;
const bot = new Bot(source, settings, conversation);
client.once(Events.ClientReady, ready => console.log(`Syl connected as ${ready.user.tag}. Conversations: ${enabled ? model : 'disabled (missing OPENAI_API_KEY)'}. Research: ${enabled ? researchModel : 'disabled'}. Source: Wowhead Forever.`));
client.on(Events.InteractionCreate, interaction => { void bot.handle(interaction); });
client.on(Events.MessageCreate, message => { void conversation?.handle(message).catch(error => console.error('Message handling failed:', error instanceof Error ? error.name : 'UnknownError')); });
client.on(Events.Error, error => console.error('Discord client error:', error.message));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { client.destroy(); memory.close(); process.exit(0); });
}
setInterval(() => memory.prune(), 60_000).unref();
await client.login(token);
