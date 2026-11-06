import { createServer, type IncomingMessage } from 'node:http';
import { SnapshotStore, maxSnapshotBytes, type SnapshotOwner } from './snapshots.js';
import { UserError } from './model.js';

export async function readSnapshotBody(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    if (length > maxSnapshotBytes) throw new UserError('Snapshot exceeds 256 KB.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function snapshotServer(store: SnapshotStore, isMember: (owner: SnapshotOwner) => Promise<boolean>) {
  const limits = new Map<string, { count: number; expires: number }>();
  let active = 0;
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, (request, response) => {
    const send = (status: number, body: unknown) => {
      if (!response.destroyed) response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    };
    const handle = async (request: IncomingMessage) => {
      const checkConnection = request.method === 'GET' && request.url === '/v1/snapshots/status';
      if (!checkConnection && (request.method !== 'POST' || request.url !== '/v1/snapshots')) { send(404, { error: 'Not found.' }); return; }
      const owner = store.authenticate(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
      if (!owner) { send(401, { error: 'Upload token is missing, expired or revoked.' }); return; }
      for (const [key, limit] of limits) if (limit.expires <= Date.now()) limits.delete(key);
      const key = `${owner.guildId}:${owner.userId}`, previous = limits.get(key);
      if (active >= 16 || (previous?.count ?? 0) >= 10 || (!previous && limits.size >= 10_000)) {
        response.setHeader('Retry-After', '60'); send(429, { error: 'Upload limit reached. Retry later.' }); return;
      }
      limits.set(key, { count: (previous?.count ?? 0) + 1, expires: previous?.expires ?? Date.now() + 60_000 });
      active++;
      try {
        if (Number(request.headers['content-length'] ?? 0) > maxSnapshotBytes) { send(413, { error: 'Snapshot exceeds 256 KB.' }); return; }
        if (!(await isMember(owner))) { send(403, { error: 'Join the Discord server before uploading.' }); return; }
        if (checkConnection) {
          if (!store.authenticate(request.headers.authorization?.replace(/^Bearer /, '') ?? '')) { send(401, { error: 'Upload token was revoked.' }); return; }
          send(200, { connected: true }); return;
        }
        const body = await readSnapshotBody(request);
        // Recheck token revocation after asynchronous membership/body reads.
        if (!store.authenticate(request.headers.authorization?.replace(/^Bearer /, '') ?? '')) { send(401, { error: 'Upload token was revoked.' }); return; }
        send(200, store.ingest(owner, body));
      } finally { active--; }
    };
    void handle(request).catch(error => {
      send(error instanceof UserError ? 400 : 503, { error: error instanceof UserError ? error.message : 'Upload temporarily unavailable.' });
    });
  });
  server.maxConnections = 64;
  return server;
}
