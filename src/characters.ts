import { AttachmentBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { SnapshotStore, maxSnapshotBytes } from './snapshots.js';
import { readSnapshotBody } from './snapshot-api.js';
import { UserError } from './model.js';

export class Characters {
  constructor(private store: SnapshotStore, private uploadUrl?: string, private onForget?: (guildId: string) => void) {}

  async command(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (interaction.commandName !== 'character') return false;
    if (!interaction.guildId) throw new UserError('Use character commands in a server.');
    const owner = { guildId: interaction.guildId, userId: interaction.user.id };
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reply = (content: string) => interaction.editReply({ content, flags: MessageFlags.SuppressEmbeds, allowedMentions: { parse: [] } });
    if (sub === 'import') {
      const file = interaction.options.getAttachment('file', true);
      const url = new URL(file.url);
      if (file.size > maxSnapshotBytes) throw new UserError('Snapshot exceeds 256 KB.');
      if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) throw new UserError('Upload the file directly to this command.');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!response.ok || !response.body) throw new UserError('Could not download the attachment. Please upload it again.');
      const saved = this.store.ingest(owner, await readSnapshotBody(response.body));
      await reply(`${saved.status === 'saved' ? 'Saved' : 'Already have this or a newer snapshot for'} character \`${saved.characterId}\`. Its level, gear and talents are shared with this server and available to Tome. Ownership is self-reported. Use /character forget to delete it.`);
    } else if (sub === 'list') {
      const rows = this.store.list(owner.guildId, '', owner.userId);
      await reply(rows.length ? rows.map(row => `**${row.name} ${row.surname}** — level ${row.level} ${row.classToken}, ${row.realm}\n\`${row.characterId}\` · captured <t:${row.capturedAt}:R>${row.stale ? ' (stale)' : ''}`).join('\n').slice(0, 1900) : 'No characters linked yet. Use /character import with your TomeSnapshot.lua file.');
    } else if (sub === 'connect') {
      if (!this.uploadUrl) throw new UserError('Automatic upload is not hosted yet. Use /character import with your saved file for now.');
      const token = this.store.issueToken(owner);
      const config = JSON.stringify({ endpoint: this.uploadUrl, token, files: ['REPLACE_WITH_FULL_PATH_TO_CHARACTER_SAVEDVARIABLES/TomeSnapshot.lua'] }, null, 2);
      await interaction.editReply({ content: 'Download this private uploader config, set its file paths, and run the desktop uploader. Uploads share character level, gear and talents with this server. This token expires in 90 days and replaces your old token; keep the config private. Use /character disconnect to revoke it.',
        files: [new AttachmentBuilder(Buffer.from(config), { name: 'tome-upload.json' })], allowedMentions: { parse: [] } });
    } else if (sub === 'disconnect') {
      this.store.revoke(owner);
      await reply('Revoked your uploader token for this server. Existing snapshots remain; use /character forget to delete them.');
    } else if (sub === 'forget') {
      const id = interaction.options.getString('id', true);
      const removed = this.store.forget(owner, id);
      if (removed) {
        this.store.revoke(owner);
        this.onForget?.(owner.guildId);
      }
      await reply(removed ? 'Deleted that character and its snapshot history, cleared recent server conversation context, and revoked your uploader token so it cannot re-upload the character. Remove its file from the uploader config before reconnecting. Existing Discord messages remain.' : 'No character with that ID belongs to you in this server.');
    }
    return true;
  }
}
