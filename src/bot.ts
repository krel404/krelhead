import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits,
  StringSelectMenuBuilder, type Interaction, type ChatInputCommandInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { entityTypes, entityUrl, isEntityType, labels, searchUrl, SourceError, UserError, type SearchResult } from './model.js';
import { tooltipMessage } from './tooltip.js';
import { SettingsStore } from './settings.js';
import { Wowhead } from './wowhead.js';

type Selection = { userId: string; results: SearchResult[]; query: string; expires: number };
export class Bot {
  private selections = new Map<string, Selection>();
  constructor(private source: Wowhead, private settings: SettingsStore) {}

  async handle(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isAutocomplete()) {
        if (this.settings.muted(interaction.guildId, interaction.channelId)) { await interaction.respond([]); return; }
        const query = String(interaction.options.getFocused()).trim();
        if (query.length < 2) { await interaction.respond([]); return; }
        const type = isEntityType(interaction.commandName) ? interaction.commandName : interaction.options.getString('type');
        // Discord autocomplete cannot be deferred. Respond before the 3s deadline;
        // a slow request may finish in the background and populate the source cache.
        let timer: ReturnType<typeof setTimeout> | undefined;
        let results: SearchResult[];
        try {
          results = await Promise.race([
            this.source.search(query, isEntityType(type) ? type : undefined),
            new Promise<SearchResult[]>(resolve => { timer = setTimeout(() => resolve([]), 1800); }),
          ]);
        } catch { results = []; }
        finally { clearTimeout(timer); }
        await interaction.respond(results.map(result => ({
          name: `${labels[result.type]} · ${result.name}${result.rank ? ` (${result.rank})` : ''} · #${result.id}`.slice(0, 100),
          value: `${result.type}:${result.id}`,
        })));
        return;
      }
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('lookup:')) {
        await this.select(interaction); return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === 'help') {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: [
          '**Krelhead · WoW Forever**',
          '`/search query:Hogger` — search items, NPCs, spells, and quests.',
          '`/item query:Thunderfury` — limit the search; `/npc`, `/spell`, and `/quest` work the same way.',
          '`/spell query:116` — look up an ID directly.',
          '`/tooltip query:item:19019` — `/tooltip` and `/tt` are aliases of `/search`.',
          'You can also paste a Wowhead **Forever** URL. Autocomplete shows matching names and spell ranks.',
          'The top match is shown immediately. Use the result picker to view another match.',
          '`/setup` — enable or mute lookups for a server (Manage Server) or channel (Manage Channels). Channel preferences override server preferences.',
          '**Source:** https://www.wowhead.com/forever/database',
          'Forever data is still incomplete. Missing entries are never substituted with Classic or Retail data.',
        ].join('\n'), allowedMentions: { parse: [] } });
        return;
      }
      if (interaction.commandName === 'setup') { await this.setup(interaction); return; }
      if (!['search', 'tooltip', 'tt', ...entityTypes].includes(interaction.commandName)) return;
      if (this.settings.muted(interaction.guildId, interaction.channelId)) {
        await interaction.reply({ content: 'Lookups are muted here. A moderator can change this with /setup.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply();
      const query = interaction.options.getString('query', true);
      const type = isEntityType(interaction.commandName) ? interaction.commandName : interaction.options.getString('type');
      const results = await this.source.search(query, isEntityType(type) ? type : undefined);
      if (!results.length) {
        await interaction.editReply({ content: `No matching ${isEntityType(type) ? labels[type].toLowerCase() : 'entry'} found in Wowhead’s Forever database. Data may not be available yet.\n[Search Wowhead directly](${searchUrl(query)})`, allowedMentions: { parse: [] } });
        return;
      }
      const first = results[0]!;
      const tooltip = await this.source.tooltip(first);
      const payload = await tooltipMessage(tooltip);
      const token = this.remember(interaction.user.id, results, query);
      await interaction.editReply({ ...payload, components: this.components(token, results, first, query) });
    } catch (error) {
      const content = error instanceof UserError || error instanceof SourceError ? error.message : 'Something went wrong with this lookup. Please try again.';
      console.error('Interaction failed:', error instanceof Error ? error.message : 'Unknown error');
      try {
        if (interaction.isAutocomplete()) {
          if (!interaction.responded) await interaction.respond([]);
        } else if (interaction.isRepliable()) {
          if (interaction.deferred || interaction.replied) {
            // Component errors must not overwrite a previously successful shared result.
            if (interaction.isMessageComponent()) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
            else await interaction.editReply({ content, embeds: [], components: [], attachments: [] });
          } else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      } catch (replyError) { console.error('Could not report interaction failure:', replyError instanceof Error ? replyError.message : 'Unknown error'); }
    }
  }

  private remember(userId: string, results: SearchResult[], query: string): string {
    for (const [key, value] of this.selections) if (value.expires <= Date.now()) this.selections.delete(key);
    if (this.selections.size >= 1000) this.selections.delete(this.selections.keys().next().value!);
    const token = randomBytes(12).toString('hex');
    this.selections.set(token, { userId, results, query, expires: Date.now() + 15 * 60_000 });
    return token;
  }

  private components(token: string, results: SearchResult[], current: SearchResult, query: string) {
    const rows: (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] = [];
    if (results.length > 1) {
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`lookup:${token}`).setPlaceholder('Choose another match · available for 15 minutes')
        .addOptions(results.map(result => ({
          label: result.name.slice(0, 100),
          description: `${labels[result.type]}${result.rank ? ` · ${result.rank}` : ''} · #${result.id}`.slice(0, 100),
          value: `${result.type}:${result.id}`, default: result.type === current.type && result.id === current.id,
        })))));
    }
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('View on Wowhead').setStyle(ButtonStyle.Link).setURL(entityUrl(current)),
      new ButtonBuilder().setLabel('All search results').setStyle(ButtonStyle.Link).setURL(searchUrl(query)),
    ));
    return rows;
  }

  private async select(interaction: StringSelectMenuInteraction): Promise<void> {
    const token = interaction.customId.slice('lookup:'.length);
    const selection = this.selections.get(token);
    if (!selection || selection.expires <= Date.now()) {
      this.selections.delete(token);
      await interaction.reply({ content: 'This search has expired. Run the command again for fresh results.', flags: MessageFlags.Ephemeral }); return;
    }
    if (selection.userId !== interaction.user.id) {
      await interaction.reply({ content: 'Run your own /search to choose a result.', flags: MessageFlags.Ephemeral }); return;
    }
    if (this.settings.muted(interaction.guildId, interaction.channelId)) {
      await interaction.reply({ content: 'Lookups are muted here.', flags: MessageFlags.Ephemeral }); return;
    }
    const result = selection.results.find(r => `${r.type}:${r.id}` === interaction.values[0]);
    if (!result) throw new UserError('That result is not part of this search.');
    await interaction.deferUpdate();
    const tooltip = await this.source.tooltip(result);
    await interaction.editReply({ ...await tooltipMessage(tooltip), attachments: [],
      components: this.components(token, selection.results, result, selection.query) });
  }

  private async setup(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.channelId) throw new UserError('Run /setup in a server channel.');
    const scope = interaction.options.getString('scope', true);
    const required = scope === 'server' ? PermissionFlagsBits.ManageGuild : PermissionFlagsBits.ManageChannels;
    if (!interaction.memberPermissions?.has(required)) throw new UserError(`You need ${scope === 'server' ? 'Manage Server' : 'Manage Channels'} permission to change this setting.`);
    const mode = interaction.options.getString('mode', true);
    this.settings.set(interaction.guildId, scope === 'channel' ? interaction.channelId : null, mode === 'reset' ? null : mode === 'muted');
    await interaction.reply({ content: `${scope === 'channel' ? 'Channel' : 'Server'} lookup preference: ${mode === 'reset' ? 'reset' : mode}. Channel preferences take priority over server preferences.`, flags: MessageFlags.Ephemeral });
  }
}
