export const entityTypes = ['item', 'npc', 'spell', 'quest'] as const;
export type EntityType = (typeof entityTypes)[number];
export const labels: Record<EntityType, string> = {
  item: 'Item', npc: 'NPC', spell: 'Spell', quest: 'Quest',
};
export const site = 'https://www.wowhead.com/forever';
export type EntityRef = { type: EntityType; id: number };
export type SearchResult = EntityRef & { name: string; rank?: string; popularity: number };
export type Tooltip = EntityRef & { name: string; html: string; icon?: string; quality?: number };

export function isEntityType(value: unknown): value is EntityType {
  return entityTypes.includes(value as EntityType);
}

export function entityUrl(ref: EntityRef): string {
  return `${site}/${ref.type}=${ref.id}`;
}

export function searchUrl(query: string): string {
  return `${site}/search?q=${encodeURIComponent(query)}`;
}

export class UserError extends Error {}
export class SourceError extends Error {}

// URLs are parsed for an ID; user-controlled hosts are never fetched.
export function parseReference(query: string, type?: EntityType): EntityRef | undefined {
  const value = query.trim();
  let match: RegExpMatchArray | null;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { throw new UserError('That URL is invalid.'); }
    if (!['wowhead.com', 'www.wowhead.com'].includes(url.hostname) || url.username || url.password || url.port) {
      throw new UserError('Use a Wowhead Forever URL, a name, or an ID.');
    }
    match = url.pathname.match(/^\/forever\/(item|npc|spell|quest)=(\d+)(?:\/|$)/);
    if (!match) throw new UserError('Use a Forever item, NPC, spell, or quest URL. Other game versions are not searched.');
  } else {
    match = value.match(/^(item|npc|spell|quest)[:=](\d+)$/i);
    if (!match && /^\d+$/.test(value)) {
      if (!type) throw new UserError('For a numeric ID, choose a type or use item:19019, npc:448, spell:116, or quest:176.');
      match = [value, type, value];
    }
  }
  if (!match) return undefined;
  const parsedType = match[1]!.toLowerCase() as EntityType;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new UserError('IDs must be positive whole numbers.');
  if (type && type !== parsedType) throw new UserError(`This is a ${parsedType} reference. Use /${parsedType} or /search.`);
  return { type: parsedType, id };
}
