#!/usr/bin/env node
// Standalone Node 22+ companion. No Discord bot token or OpenAI key is needed.
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export function validateConnection(value) {
  if (!value || typeof value !== 'object' || !/^[a-f0-9]{64}$/.test(value.token ?? '')) throw new Error('Invalid uploader token. Download a config using /character connect.');
  const url = new URL(value.endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/v1/snapshots' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use an HTTPS snapshot endpoint; HTTP is allowed only on this computer.');
  }
  return { endpoint: url.href, token: value.token };
}

export function validateConfig(value) {
  const connection = validateConnection(value);
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 25 || value.files.some(file => typeof file !== 'string' || !file || file.includes('REPLACE_WITH'))) {
    throw new Error('Set files to the explicit TomeSnapshot.lua paths for the characters you want to share.');
  }
  return { ...connection, files: [...new Set(value.files)] };
}

export async function verifyConnection(config) {
  const response = await fetch(`${config.endpoint}/status`, { redirect: 'error',
    headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Connection file could not be verified. Check that Tome is online and download a new file using /character connect.');
  if ((await response.json()).connected !== true) throw new Error('Connection file did not point to a working Tome upload service.');
}

export async function readSnapshotFile(file) {
  if ((await stat(file)).size > 256_000) throw new Error('Snapshot exceeds 256 KB.');
  const chunks = [];
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    size += chunk.length;
    if (size > 256_000) throw new Error('Snapshot exceeds 256 KB.');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const digest = createHash('sha256').update(body).digest('hex');
  return { body, digest };
}

export async function uploadSnapshot(config, body, signal) {
  if (body.length > 256_000) throw new Error('Snapshot exceeds 256 KB.');
  const response = await fetch(config.endpoint, { method: 'POST', body, redirect: 'error',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'text/plain; charset=utf-8' },
    signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]) });
  if (!response.ok) {
    const error = new Error(`Upload returned HTTP ${response.status}. ${response.status === 401 ? 'Reconnect using /character connect.' : 'Check the snapshot, server and membership; the file will be retried.'}`);
    error.status = response.status;
    throw error;
  }
  await response.arrayBuffer();
}

export async function uploadFile(config, file, previousDigest, signal) {
  const { body, digest } = await readSnapshotFile(file);
  if (digest === previousDigest) return digest;
  await uploadSnapshot(config, body, signal);
  return digest;
}

async function main() {
  const path = process.argv[2];
  if (!path || path.startsWith('--')) throw new Error('Usage: node tome-uploader.mjs /path/to/tome-upload.json [--once]');
  if ((await stat(path)).size > 16_000) throw new Error('Config is too large.');
  const config = validateConfig(JSON.parse(await readFile(path, 'utf8')));
  const controller = new AbortController();
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => controller.abort());
  const uploaded = new Map();
  console.log('Watching only configured character files. WoW writes snapshots on /reload, logout or exit. Press Ctrl+C to stop.');
  do {
    let failed = false;
    for (const file of config.files) {
      if (controller.signal.aborted) return;
      try {
        const digest = await uploadFile(config, resolve(file), uploaded.get(file), controller.signal);
        if (digest !== uploaded.get(file)) console.log('Character snapshot synced.');
        uploaded.set(file, digest);
      } catch (error) {
        if (controller.signal.aborted) return;
        failed = true;
        // Avoid printing local account paths, snapshot content, credentials or request objects.
        console.error(error.code === 'ENOENT' ? 'Snapshot file not found yet. Check the path, then /reload in game.' : error.message.startsWith('Upload returned') ? error.message : 'Could not sync a snapshot. Check the file and connection; retrying.');
      }
    }
    if (process.argv.includes('--once')) { if (failed) process.exitCode = 1; return; }
    await sleep(failed ? 60_000 : 5000, undefined, { signal: controller.signal }).catch(() => {});
  } while (!controller.signal.aborted);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Could not start uploader. Check the config path, endpoint, token and file paths. Usage: node tome-uploader.mjs tome-upload.json [--once]'); process.exitCode = 1; });
}
