import { SlashCommandBuilder } from 'discord.js';
import { entityTypes, isEntityType, labels } from './model.js';

export const commands = [
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
  new SlashCommandBuilder().setName('setup').setDescription('Mute or unmute lookups in this server or channel')
    .setDMPermission(false)
    .addStringOption(option => option.setName('scope').setDescription('Where this preference applies').setRequired(true)
      .addChoices({ name: 'This channel', value: 'channel' }, { name: 'This server', value: 'server' }))
    .addStringOption(option => option.setName('mode').setDescription('Channel overrides take priority over server preferences').setRequired(true)
      .addChoices({ name: 'Enable lookups', value: 'enabled' }, { name: 'Mute lookups', value: 'muted' }, { name: 'Reset to default / inherit server', value: 'reset' })),
];
