import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { UserError } from './model.js';

export type Scope = { guildId: string; channelId: string; userId: string };
export type Fact = { id: string; fact: string; created: string };
export type GuildDefaults = { faction: 'Horde' | 'Alliance'; focus: 'PvP' | 'PvE' };
export type Turn = { role: 'user' | 'assistant'; content: string };
export const scopeKey = (scope: Scope) => `${scope.guildId}:${scope.channelId}:${scope.userId}`;

export class MemoryStore {
  private db: DatabaseSync;
  private recent = new Map<string, { expires: number; turns: Turn[] }>();

  constructor(path: string, private now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA secure_delete = ON; CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, fact TEXT NOT NULL, created TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS facts_scope ON facts(scope);
    CREATE TABLE IF NOT EXISTS guild_defaults (
      guild_id TEXT PRIMARY KEY,
      faction TEXT NOT NULL CHECK (faction IN ('Horde', 'Alliance')),
      focus TEXT NOT NULL CHECK (focus IN ('PvP', 'PvE'))
    );`);
  }

  guildDefaults(guildId: string): GuildDefaults | undefined {
    const row = this.db.prepare('SELECT faction, focus FROM guild_defaults WHERE guild_id = ?').get(guildId) as GuildDefaults | undefined;
    return row ? { ...row } : undefined;
  }

  setGuildDefaults(guildId: string, defaults: GuildDefaults): void {
    this.db.prepare(`INSERT INTO guild_defaults (guild_id, faction, focus) VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET faction = excluded.faction, focus = excluded.focus`)
      .run(guildId, defaults.faction, defaults.focus);
    for (const key of this.recent.keys()) if (key.startsWith(`${guildId}:`)) this.recent.delete(key);
  }

  list(scope: Scope): Fact[] {
    return this.db.prepare('SELECT id, fact, created FROM facts WHERE scope = ? ORDER BY created, id')
      .all(scopeKey(scope)) as Fact[];
  }

  save(scope: Scope, text: string): Fact {
    const fact = text.trim();
    if (!fact || fact.length > 400) throw new UserError('Save a fact between 1 and 400 characters.');
    if (this.list(scope).length >= 20) throw new UserError('You have 20 saved facts here. Use /forget to remove one first.');
    const row = { id: randomUUID(), fact, created: new Date(this.now()).toISOString() };
    this.db.prepare('INSERT INTO facts VALUES (?, ?, ?, ?)').run(row.id, scopeKey(scope), fact, row.created);
    return row;
  }

  forget(scope: Scope, id: string): boolean {
    const deleted = this.db.prepare('DELETE FROM facts WHERE scope = ? AND id = ?').run(scopeKey(scope), id).changes > 0;
    // Answers may repeat a saved fact; discard context when it is deleted.
    if (deleted) this.reset(scope);
    return deleted;
  }

  history(scope: Scope): Turn[] {
    this.prune();
    return this.recent.get(scopeKey(scope))?.turns.slice() ?? [];
  }

  append(scope: Scope, question: string, answer: string): void {
    const turns: Turn[] = [...this.history(scope), { role: 'user', content: question }, { role: 'assistant', content: answer }];
    if (this.recent.size >= 500) this.recent.delete(this.recent.keys().next().value!);
    this.recent.set(scopeKey(scope), { expires: this.now() + 30 * 60_000, turns: turns.slice(-12) });
  }

  reset(scope: Scope): void { this.recent.delete(scopeKey(scope)); }
  prune(): void { for (const [key, value] of this.recent) if (value.expires <= this.now()) this.recent.delete(key); }
  close(): void { this.db.close(); this.recent.clear(); }
}
