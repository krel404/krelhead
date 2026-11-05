import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Run before opening MemoryStore, with only one bot process running.
export function memoryDatabasePath(directory: string): string {
  const current = resolve(directory, 'tome.sqlite');
  const legacy = resolve(directory, 'syl.sqlite');
  if (!existsSync(legacy)) return current;
  if (existsSync(current)) throw new Error('Both old and new memory databases exist. Resolve the duplicate before starting Tome; neither was modified.');
  const db = new DatabaseSync(legacy);
  try {
    // Recover any journal and consolidate WAL before moving the database file.
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (Number(checkpoint?.busy ?? 0) !== 0) throw new Error('Stop the previous bot process before migrating memory.');
    db.exec('PRAGMA journal_mode = DELETE');
  } finally { db.close(); }
  copyFileSync(legacy, `${current}.pre-rename.bak`);
  renameSync(legacy, current);
  return current;
}
