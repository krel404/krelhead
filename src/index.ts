import { resolve } from 'node:path';
import { ApplicationFlagsBitField, Client, Events, GatewayIntentBits, Options, REST, Routes, type RESTGetAPIOAuth2CurrentApplicationResult } from 'discord.js';
import { Bot } from './bot.js';
import { required } from './config.js';
import { SettingsStore } from './settings.js';
import { Wowhead } from './wowhead.js';
import OpenAI from 'openai';
import { MemoryStore } from './memory.js';
import { Conversation } from './conversation.js';
import { Tome, defaultModel, defaultResearchModel } from './tome.js';
import { SnapshotStore } from './snapshots.js';
import { snapshotServer } from './snapshot-api.js';
import { Characters } from './characters.js';
import { memoryDatabasePath } from './migrations.js';

const token = required('DISCORD_TOKEN');
const enabled = Boolean(process.env.OPENAI_API_KEY?.trim());
if (enabled) {
  const application = await new REST({ version: '10' }).setToken(token).get(Routes.oauth2CurrentApplication()) as RESTGetAPIOAuth2CurrentApplicationResult;
  const flags = new ApplicationFlagsBitField(application.flags);
  if (!(flags.has('GatewayMessageContent') || flags.has('GatewayMessageContentLimited')) ||
      !(flags.has('GatewayGuildMembers') || flags.has('GatewayGuildMembersLimited'))) {
    throw new Error(`Enable Message Content Intent and Server Members Intent before starting Tome: https://discord.com/developers/applications/${application.id}/bot`);
  }
}
const client = new Client({ intents: [GatewayIntentBits.Guilds,
  ...(enabled ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] : [])],
  allowedMentions: { parse: [], repliedUser: false }, makeCache: Options.cacheWithLimits({ MessageManager: 0 }) });
const source = new Wowhead();
const settings = new SettingsStore(resolve(process.env.DATA_DIR ?? 'data', 'settings.json'));
const memory = new MemoryStore(memoryDatabasePath(process.env.DATA_DIR ?? 'data'));
const snapshots = new SnapshotStore(resolve(process.env.DATA_DIR ?? 'data', 'characters.sqlite'));
const model = process.env.OPENAI_MODEL?.trim() || defaultModel;
const researchModel = process.env.OPENAI_RESEARCH_MODEL?.trim() || defaultResearchModel;
const conversation = enabled ? new Conversation(new Tome(new OpenAI({ timeout: 60_000, maxRetries: 0 }), source, model, researchModel), memory, settings, snapshots) : undefined;
const port = process.env.SNAPSHOT_PORT ? Number(process.env.SNAPSHOT_PORT) : undefined;
if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid SNAPSHOT_PORT.');
const uploadUrl = process.env.SNAPSHOT_PUBLIC_URL?.trim();
if (uploadUrl) {
  const url = new URL(uploadUrl);
  if (!port || url.pathname !== '/v1/snapshots' || url.search || url.hash || url.username || url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('SNAPSHOT_PUBLIC_URL must be an HTTPS /v1/snapshots endpoint (HTTP loopback allowed), with SNAPSHOT_PORT set.');
  }
}
const uploads = port ? snapshotServer(snapshots, async owner => {
  const guild = client.guilds.cache.get(owner.guildId);
  if (!guild) return false;
  try { await guild.members.fetch({ user: owner.userId, force: true, cache: false }); return true; }
  catch (error) { if ((error as { code?: number }).code === 10007) return false; throw error; }
}) : undefined;
const bot = new Bot(source, settings, conversation, new Characters(snapshots, uploadUrl, guildId => memory.resetGuild(guildId)));
client.once(Events.ClientReady, ready => console.log(`Tome connected as ${ready.user.tag}. Conversations: ${enabled ? model : 'disabled (missing OPENAI_API_KEY)'}. Research: ${enabled ? researchModel : 'disabled'}. Source: Wowhead Forever.`));
client.on(Events.InteractionCreate, interaction => { void bot.handle(interaction); });
client.on(Events.MessageCreate, message => { void conversation?.handle(message).catch(error => console.error('Message handling failed:', error instanceof Error ? error.name : 'UnknownError')); });
client.on(Events.Error, error => console.error('Discord client error:', error.message));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { uploads?.close(); client.destroy(); memory.close(); snapshots.close(); process.exit(0); });
}
setInterval(() => memory.prune(), 60_000).unref();
await client.login(token);
if (uploads) {
  uploads.on('error', error => { console.error('Snapshot server failed:', error.message); process.exit(1); });
  uploads.listen(port, process.env.SNAPSHOT_HOST?.trim() || '127.0.0.1', () => console.log('Authenticated snapshot uploads enabled.'));
}
