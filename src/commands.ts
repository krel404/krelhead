import { SlashCommandBuilder } from 'discord.js';
import { entityTypes, isEntityType, labels } from './model.js';

export const commands = [
  new SlashCommandBuilder().setName('remember').setDescription('Save a fact for your conversations here; Syl may use it in public replies')
    .setDMPermission(false).addStringOption(option => option.setName('fact').setDescription('A fact or preference for this channel only')
      .setRequired(true).setMinLength(1).setMaxLength(400)),
  new SlashCommandBuilder().setName('memories').setDescription('Privately list your saved facts in this channel').setDMPermission(false),
  new SlashCommandBuilder().setName('forget').setDescription('Delete one of your saved facts and clear recent context here')
    .setDMPermission(false).addStringOption(option => option.setName('id').setDescription('The ID shown by /memories').setRequired(true)),
  new SlashCommandBuilder().setName('resetcontext').setDescription('Clear your recent conversation context here; keep saved facts').setDMPermission(false),
  ...['tooltip', 'tt', 'search', ...entityTypes].map(name => {
    const command = new SlashCommandBuilder().setName(name)
      .setDescription(`Search Wowhead’s WoW Forever ${isEntityType(name) ? name + ' database' : 'items, NPCs, spells, and quests'}`)
      .addStringOption(option => option.setName('query').setDescription('Name, numeric ID, type:ID, or Wowhead Forever URL')
        .setRequired(true).setMinLength(1).setMaxLength(200).setAutocomplete(true));
    if (!isEntityType(name)) {
      command.addStringOption(option => option.setName('type').setDescription('Limit results to one type')
        .addChoices(...entityTypes.map(value => ({ name: labels[value], value }))));
    }
    return command;
  }),
  new SlashCommandBuilder().setName('help').setDescription('How to search the WoW Forever database'),
  new SlashCommandBuilder().setName('setup').setDescription('Mute or unmute Syl and lookups in this server or channel')
    .setDMPermission(false)
    .addStringOption(option => option.setName('scope').setDescription('Where this preference applies').setRequired(true)
      .addChoices({ name: 'This channel', value: 'channel' }, { name: 'This server', value: 'server' }))
    .addStringOption(option => option.setName('mode').setDescription('Channel overrides take priority over server preferences').setRequired(true)
      .addChoices({ name: 'Enable lookups', value: 'enabled' }, { name: 'Mute lookups', value: 'muted' }, { name: 'Reset to default / inherit server', value: 'reset' })),
];
