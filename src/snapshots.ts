import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { UserError } from './model.js';

export const maxSnapshotBytes = 256_000;
export type SnapshotOwner = { guildId: string; userId: string };
export type Equipment = { slot: number; status: 'empty' | 'equipped' | 'unavailable'; itemId?: number; itemString?: string; name?: string };
export type Talent = { treeId: number; nodeId: number; entryId: number; rank: number; spellId?: number; name?: string };
export type Snapshot = {
  schemaVersion: 1; addonVersion: string; capturedAt: number;
  game: { version: string; build: string; interface: number; region: number };
  character: { guid: string; name: string; surname: string; realm: string; classToken: string; raceToken: string; faction: string; level: number };
  equipment: Equipment[];
  talents: { status: 'complete' | 'unavailable' | 'pending'; configId?: number; nodes: Talent[] };
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UserError('Invalid snapshot object.');
  return value as Record<string, unknown>;
};
function text(value: unknown, max = 100, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new UserError('Invalid snapshot text.');
  return value;
}
function integer(value: unknown, min = 1, max = 2_147_483_647): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new UserError('Invalid snapshot number.');
  return Number(value);
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new UserError('Invalid snapshot list.');
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new UserError('Invalid snapshot value.');
  return value as T;
}

// Accept only our hex envelope or JSON. Never evaluate uploaded Lua or deserialize arbitrary tables.
export function decodeSnapshot(input: string, now = Date.now()): Snapshot {
  if (Buffer.byteLength(input) > maxSnapshotBytes) throw new UserError('Snapshot exceeds 256 KB.');
  let source = input.trim();
  // Continue accepting existing player exports after the brand/protocol-prefix rename.
  const saved = /^(?:TomeSnapshotExport|SylSnapshotExport)\s*=\s*"((?:TOME1|SYL1):[a-fA-F0-9]+)"\s*;?$/.exec(source);
  if (saved) source = saved[1]!;
  const encoded = /^(?:TOME1|SYL1):(.*)$/.exec(source);
  if (encoded) {
    const hex = encoded[1]!;
    if (!/^(?:[a-fA-F0-9]{2})+$/.test(hex)) throw new UserError('Invalid snapshot encoding.');
    source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(hex, 'hex'));
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new UserError('Upload the TomeSnapshot.lua saved file or the /tomesnapshot export.'); }
  const root = object(parsed), game = object(root.game), c = object(root.character), talents = object(root.talents);
  if (root.schemaVersion !== 1) throw new UserError('Unsupported snapshot version; update the addon.');
  const capturedAt = integer(root.capturedAt, 1, Math.floor(now / 1000) + 300);
  const iface = integer(game.interface, 16000, 16999);
  const guid = text(c.guid, 80);
  if (!/^Player-[0-9]+-[0-9A-Fa-f]+$/.test(guid)) throw new UserError('Invalid player identifier.');
  const equipment = array(root.equipment, 19).map(raw => {
    const e = object(raw);
    const entry: Equipment = { slot: integer(e.slot, 1, 19), status: choice(e.status, ['empty', 'equipped', 'unavailable']) };
    if (e.itemId !== undefined) entry.itemId = integer(e.itemId);
    if (entry.status === 'equipped' && !entry.itemId) throw new UserError('Equipped items need an item ID.');
    if (entry.status === 'empty' && (e.itemId !== undefined || e.itemString !== undefined || e.name !== undefined)) throw new UserError('Empty slots cannot contain items.');
    if (e.name !== undefined) entry.name = text(e.name, 200);
    if (e.itemString !== undefined) {
      entry.itemString = text(e.itemString, 1500);
      if (!/^item:[0-9]+(?::[-0-9]*)*$/.test(entry.itemString) || Number(entry.itemString.split(':')[1]) !== entry.itemId) throw new UserError('Item instance does not match its item ID.');
    }
    return entry;
  }).sort((a, b) => a.slot - b.slot);
  if (equipment.length !== 19 || new Set(equipment.map(e => e.slot)).size !== 19) throw new UserError('Snapshot must describe all 19 equipment slots.');
  const nodes = array(talents.nodes, 150).map(raw => {
    const n = object(raw);
    return { treeId: integer(n.treeId), nodeId: integer(n.nodeId), entryId: integer(n.entryId), rank: integer(n.rank, 1, 100),
      ...(n.spellId === undefined ? {} : { spellId: integer(n.spellId) }), ...(n.name === undefined ? {} : { name: text(n.name, 200) }) };
  }).sort((a, b) => a.nodeId - b.nodeId);
  if (new Set(nodes.map(n => n.nodeId)).size !== nodes.length) throw new UserError('Duplicate talent nodes.');
  const status = choice(talents.status, ['complete', 'unavailable', 'pending']);
  if (status !== 'complete' && nodes.length) throw new UserError('Unavailable talents cannot be reported as learned.');
  return { schemaVersion: 1, addonVersion: text(root.addonVersion, 30), capturedAt,
    game: { version: text(game.version, 30), build: text(game.build, 30), interface: iface, region: integer(game.region, 1, 10) },
    character: { guid, name: text(c.name, 80), surname: text(c.surname, 80, true), realm: text(c.realm, 100),
      classToken: choice(c.classToken, ['WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'PRIEST', 'SHAMAN', 'MAGE', 'WARLOCK', 'DRUID']),
      raceToken: text(c.raceToken, 80), faction: choice(c.faction, ['Horde', 'Alliance', 'Neutral']), level: integer(c.level, 1, 100) },
    equipment, talents: { status, ...(talents.configId === undefined ? {} : { configId: integer(talents.configId) }), nodes } };
}

export const characterId = (snapshot: Snapshot) => `${snapshot.game.region}/${snapshot.character.guid}`;

export class SnapshotStore {
  private db: DatabaseSync;
  constructor(path: string, private now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS snapshots (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL, received_at INTEGER NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (guild_id, character_id, captured_at));
      CREATE INDEX IF NOT EXISTS snapshot_owner ON snapshots(guild_id, user_id);
      CREATE TABLE IF NOT EXISTS upload_tokens (
        digest TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
        UNIQUE(guild_id, user_id));`);
  }
  ingest(owner: SnapshotOwner, input: string) {
    const snapshot = decodeSnapshot(input, this.now());
    const id = characterId(snapshot), data = JSON.stringify(snapshot), digest = hash(data);
    const existing = this.db.prepare('SELECT user_id, captured_at, digest FROM snapshots WHERE guild_id = ? AND character_id = ? ORDER BY captured_at DESC LIMIT 1')
      .get(owner.guildId, id) as { user_id: string; captured_at: number; digest: string } | undefined;
    if (existing && existing.user_id !== owner.userId) throw new UserError('That character is already linked to another Discord member in this server.');
    if (existing && (existing.digest === digest || existing.captured_at >= snapshot.capturedAt)) return { characterId: id, status: 'unchanged' as const };
    if (!existing && this.list(owner.guildId, '', owner.userId).length >= 25) throw new UserError('You can link up to 25 characters per server. Forget an old character first.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?)').run(owner.guildId, owner.userId, id, snapshot.capturedAt, this.now(), digest, data);
      this.db.prepare(`DELETE FROM snapshots WHERE guild_id = ? AND character_id = ? AND captured_at NOT IN
        (SELECT captured_at FROM snapshots WHERE guild_id = ? AND character_id = ? ORDER BY captured_at DESC LIMIT 20)`)
        .run(owner.guildId, id, owner.guildId, id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { characterId: id, status: 'saved' as const };
  }
  list(guildId: string, query = '', userId?: string) {
    const rows = this.db.prepare(`SELECT s.* FROM snapshots s JOIN
      (SELECT character_id, MAX(captured_at) AS latest FROM snapshots WHERE guild_id = ? GROUP BY character_id) l
      ON s.character_id = l.character_id AND s.captured_at = l.latest WHERE s.guild_id = ?
      AND (? IS NULL OR s.user_id = ?) AND (? = '' OR instr(lower(json_extract(s.data, '$.character.name') || ' ' || json_extract(s.data, '$.character.surname')), lower(?)) > 0)
      ORDER BY s.captured_at DESC, s.character_id LIMIT 25`).all(guildId, guildId, userId ?? null, userId ?? null, query, query);
    return rows.map(row => {
      const snapshot = JSON.parse(String(row.data)) as Snapshot;
      return { characterId: String(row.character_id), ownerDiscordId: String(row.user_id), ...snapshot.character,
        capturedAt: snapshot.capturedAt, receivedAt: new Date(Number(row.received_at)).toISOString(),
        stale: this.now() - snapshot.capturedAt * 1000 > 24 * 60 * 60_000 };
    });
  }
  get(guildId: string, id: string) {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE guild_id = ? AND character_id = ? ORDER BY captured_at DESC LIMIT 1').get(guildId, id);
    if (!row) return { error: 'No linked snapshot for that character in this server.' };
    const snapshot = JSON.parse(String(row.data)) as Snapshot;
    return { characterId: id, ownerDiscordId: String(row.user_id), snapshot,
      receivedAt: new Date(Number(row.received_at)).toISOString(), stale: this.now() - snapshot.capturedAt * 1000 > 24 * 60 * 60_000,
      provenance: 'Player-uploaded addon snapshot, shared with this Discord server. Character ownership and data are self-reported, not Blizzard-verified. This does not indicate online status.' };
  }
  forget(owner: SnapshotOwner, id: string): boolean {
    return this.db.prepare('DELETE FROM snapshots WHERE guild_id = ? AND user_id = ? AND character_id = ?').run(owner.guildId, owner.userId, id).changes > 0;
  }
  issueToken(owner: SnapshotOwner): string {
    const token = randomBytes(32).toString('hex');
    this.db.prepare(`INSERT INTO upload_tokens VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id)
      DO UPDATE SET digest = excluded.digest, expires_at = excluded.expires_at`).run(hash(token), owner.guildId, owner.userId, this.now() + 90 * 24 * 60 * 60_000);
    return token;
  }
  authenticate(token: string): SnapshotOwner | undefined {
    if (!/^[a-f0-9]{64}$/.test(token)) return;
    const row = this.db.prepare('SELECT guild_id, user_id FROM upload_tokens WHERE digest = ? AND expires_at > ?').get(hash(token), this.now());
    return row ? { guildId: String(row.guild_id), userId: String(row.user_id) } : undefined;
  }
  revoke(owner: SnapshotOwner): void { this.db.prepare('DELETE FROM upload_tokens WHERE guild_id = ? AND user_id = ?').run(owner.guildId, owner.userId); }
  close(): void { this.db.close(); }
}
