import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { inviteUrl, required } from './config.js';

const token = required('DISCORD_TOKEN');
const applicationId = required('DISCORD_APPLICATION_ID');
const guildId = process.env.DISCORD_GUILD_ID?.trim();
const rest = new REST({ version: '10' }).setToken(token);
// Registration is an explicit operation, never performed during normal startup.
await rest.put(guildId ? Routes.applicationGuildCommands(applicationId, guildId) : Routes.applicationCommands(applicationId),
  { body: commands.map(command => command.toJSON()) });
console.log(`Registered ${commands.length} commands ${guildId ? `in server ${guildId}` : 'globally'}.`);
console.log(`Invite: ${inviteUrl(applicationId)}`);
