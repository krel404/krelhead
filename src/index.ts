import { resolve } from 'node:path';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { Bot } from './bot.js';
import { required } from './config.js';
import { SettingsStore } from './settings.js';
import { Wowhead } from './wowhead.js';

const token = required('DISCORD_TOKEN');
const client = new Client({ intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [] } });
const bot = new Bot(new Wowhead(), new SettingsStore(resolve(process.env.DATA_DIR ?? 'data', 'settings.json')));
client.once(Events.ClientReady, ready => console.log(`Krelhead connected as ${ready.user.tag}. Source: Wowhead Forever.`));
client.on(Events.InteractionCreate, interaction => { void bot.handle(interaction); });
client.on(Events.Error, error => console.error('Discord client error:', error.message));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { client.destroy(); process.exit(0); });
}
await client.login(token);
