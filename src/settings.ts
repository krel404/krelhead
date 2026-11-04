import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type Settings = { guilds: Record<string, boolean>; channels: Record<string, boolean> };
export class SettingsStore {
  private data: Settings = { guilds: {}, channels: {} };
  constructor(private path: string) {
    try {
      const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!data || typeof data !== 'object') throw new Error('Invalid settings file');
      for (const key of ['guilds', 'channels'] as const) {
        const entries = (data as Settings)[key];
        if (!entries || typeof entries !== 'object' || Array.isArray(entries) ||
          Object.entries(entries).some(([id, value]) => !/^\d+(?::\d+)?$/.test(id) || typeof value !== 'boolean')) {
          throw new Error(`Invalid ${key} settings`);
        }
      }
      this.data = data as Settings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  muted(guild: string | null, channel: string | null): boolean {
    if (!guild) return false;
    return (channel ? this.data.channels[`${guild}:${channel}`] : undefined) ?? this.data.guilds[guild] ?? false;
  }
  set(guild: string, channel: string | null, muted: boolean | null): void {
    const next: Settings = { guilds: { ...this.data.guilds }, channels: { ...this.data.channels } };
    const target = channel ? next.channels : next.guilds;
    const key = channel ? `${guild}:${channel}` : guild;
    if (muted === null) delete target[key]; else target[key] = muted;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
    this.data = next;
  }
}
