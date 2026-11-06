import { discoverSnapshots } from './files.mjs';

// Dependencies are explicit so the same session can be exercised without Electron or a game client.
export class SyncSession {
  constructor(config, { read, upload, discover = discoverSnapshots, now = Date.now }) {
    this.config = config;
    this.read = read; this.upload = upload; this.discover = discover; this.now = now;
    this.uploaded = new Map(); this.retryAt = new Map(); this.nextUploadAt = 0;
    this.controller = new AbortController(); this.running = false;
    this.state = { message: 'Waiting for WoW to save your first snapshot.', lastSyncedAt: null, characters: 0, needsRelink: false };
  }
  stop() { this.controller.abort(); }
  async tick() {
    if (this.running || this.controller.signal.aborted || this.state.needsRelink) return;
    this.running = true;
    try {
      const files = await this.discover(this.config.root, this.config.account);
      this.state.characters = files.length;
      for (const file of this.uploaded.keys()) if (!files.includes(file)) this.uploaded.delete(file);
      if (!files.length) { this.state.message = 'Ready. Play normally—your first snapshot syncs after logout or game exit.'; return; }
      if (this.now() < this.nextUploadAt) return;
      for (const file of files) {
        if (this.controller.signal.aborted) return;
        if ((this.retryAt.get(file) || 0) > this.now()) continue;
        try {
          const { body, digest } = await this.read(file);
          if (this.uploaded.get(file) === digest) continue;
          // At most one request per eight seconds, below the server's ten-per-minute limit.
          this.nextUploadAt = this.now() + 8000;
          await this.upload(this.config.connection, body, this.controller.signal);
          this.uploaded.set(file, digest); this.retryAt.delete(file);
          this.state.lastSyncedAt = this.now();
          this.state.message = 'Synced. Updates upload automatically after logout or game exit.';
          return;
        } catch (error) {
          if (this.controller.signal.aborted) return;
          this.retryAt.set(file, this.now() + 60_000);
          if (error.status === 401 || error.status === 403) {
            this.state.needsRelink = true;
            this.state.message = 'Connection expired, revoked, or unavailable to this member. Run /character connect in Discord and import the new connection file.';
          } else if (error.status === 429) {
            this.nextUploadAt = this.now() + 60_000;
            this.state.message = 'Sync is busy. Retrying automatically in a minute.';
          } else {
            this.state.message = 'Could not sync a snapshot. It will retry automatically. Check your connection and addon if this continues.';
          }
          return;
        }
      }
    } catch {
      this.state.message = 'Cannot read the selected WoW account. Check that the game drive is connected.';
    } finally { this.running = false; }
  }
}
