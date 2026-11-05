import { load } from 'cheerio';
import { isEntityType, parseReference, searchUrl, SourceError, UserError,
  type EntityRef, type EntityType, type SearchResult, type Tooltip } from './model.js';

type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read JSON data islands only. Never evaluate Wowhead's scripts. */
export function parseSearch(html: string, query: string, type?: EntityType): SearchResult[] {
  const $ = load(html);
  const results = new Map<string, SearchResult>();
  let recognized = false;
  for (const script of $('script').toArray()) {
    const source = $(script).html() ?? '';
    for (const block of source.matchAll(/new Listview\(\{([\s\S]*?)\}\);/g)) {
      const kind = block[1]!.match(/template:\s*["'](\w+)["']/)?.[1];
      const key = block[1]!.match(/data:\s*WH\.getPageData\(["']([^"']+)["']\)/)?.[1];
      if (!key) continue;
      const island = $(`script[type="application/json"]`).toArray().find(el => $(el).attr('id') === `data.${key}`);
      if (!island) throw new SourceError('Wowhead search data is missing.');
      recognized = true;
      if (!isEntityType(kind) || (type && kind !== type)) continue;
      let rows: unknown;
      try { rows = JSON.parse($(island).html() ?? ''); } catch { throw new SourceError('Wowhead search data changed.'); }
      if (!Array.isArray(rows)) throw new SourceError('Wowhead search data changed.');
      for (const row of rows) {
        if (!object(row) || !Number.isSafeInteger(row.id) || Number(row.id) <= 0 || typeof row.name !== 'string') continue;
        const name = typeof row.displayName === 'string' && row.displayName ? row.displayName : row.name;
        const result: SearchResult = { type: kind, id: Number(row.id), name,
          rank: typeof row.rank === 'string' ? row.rank : undefined,
          popularity: typeof row.searchpopularity === 'number' ? row.searchpopularity : 0 };
        results.set(`${kind}:${result.id}`, result);
      }
    }
  }
  // A genuine empty search still renders the search page; a challenge/error page does not.
  if (!recognized && !$('#search-results').length) throw new SourceError('Wowhead returned an unrecognized search page.');
  const normalized = query.toLocaleLowerCase();
  const score = (r: SearchResult) => r.name.toLocaleLowerCase() === normalized ? 2 : r.name.toLocaleLowerCase().startsWith(normalized) ? 1 : 0;
  return [...results.values()].sort((a, b) => score(b) - score(a) || b.popularity - a.popularity);
}

export function parseTooltip(value: unknown, ref: EntityRef): Tooltip {
  if (object(value) && typeof value.error === 'string') throw new UserError('That entry is not available in Wowhead’s Forever database yet.');
  if (!object(value) || typeof value.name !== 'string' || !value.name.trim() || typeof value.tooltip !== 'string' || !value.tooltip.trim()) {
    throw new SourceError('Wowhead returned an invalid tooltip.');
  }
  return { ...ref, name: value.name, html: value.tooltip,
    icon: typeof value.icon === 'string' && /^[a-z0-9_]+$/i.test(value.icon) ? value.icon : undefined,
    quality: typeof value.quality === 'number' ? value.quality : undefined };
}

export class Wowhead {
  private cache = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private active = 0;
  private cooldownUntil = 0;

  constructor(private fetcher: typeof fetch = fetch, private now: () => number = Date.now) {}

  private async cached<T>(key: string, ttl: number, task: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return cached.value as T;
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    if (this.active >= 6) throw new SourceError('Lookups are busy. Please try again shortly.');
    const work = (async () => {
      this.active++;
      try {
        const value = await task();
        if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { value, expires: this.now() + ttl });
        return value;
      } finally { this.active--; this.pending.delete(key); }
    })();
    this.pending.set(key, work);
    return work;
  }

  private async request(url: string): Promise<Response> {
    if (this.now() < this.cooldownUntil) throw new SourceError('Wowhead is rate limiting requests. Please try again later.');
    let response: Response;
    try {
      response = await this.fetcher(url, {
        signal: AbortSignal.timeout(8000), redirect: 'error',
        headers: { 'User-Agent': 'Tome/0.1 (WoW Forever Discord lookup)', Accept: 'application/json,text/html' },
      });
    } catch { throw new SourceError('Wowhead could not be reached. Please try again shortly.'); }
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      this.cooldownUntil = this.now() + Math.max(30, Math.min(300, Number.isFinite(seconds) ? seconds : 60)) * 1000;
    }
    if (response.status === 404) throw new UserError('That entry is not available in Wowhead’s Forever database yet.');
    if (!response.ok) throw new SourceError(`Wowhead is temporarily unavailable (HTTP ${response.status}). Please try again later.`);
    return response;
  }

  async search(query: string, type?: EntityType): Promise<SearchResult[]> {
    query = query.trim();
    if (!query || query.length > 200) throw new UserError('Enter a name, ID, or Forever URL (up to 200 characters).');
    const ref = parseReference(query, type);
    if (ref) {
      const tooltip = await this.tooltip(ref);
      return [{ ...ref, name: tooltip.name, popularity: 0 }];
    }
    // Share the upstream result across typed and untyped queries.
    const results = await this.cached(`search:${query.toLowerCase()}`, 60_000, async () => {
      const response = await this.request(searchUrl(query));
      return parseSearch(await response.text(), query);
    });
    return results.filter(result => !type || result.type === type).slice(0, 25);
  }

  async tooltip(ref: EntityRef): Promise<Tooltip> {
    return this.cached(`tooltip:${ref.type}:${ref.id}`, 300_000, async () => {
      const response = await this.request(`https://nether.wowhead.com/forever/tooltip/${ref.type}/${ref.id}`);
      let value: unknown;
      try { value = await response.json(); } catch { throw new SourceError('Wowhead returned an unrecognized tooltip response.'); }
      return parseTooltip(value, ref);
    });
  }
}
