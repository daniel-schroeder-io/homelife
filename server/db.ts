import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { migrate } from './schema.ts'

const DATA_DIR =
  process.env.DATA_DIR?.trim() || join(import.meta.dir, '..', 'data')
const DB_PATH = join(DATA_DIR, 'homelife.sqlite')
const LEGACY_DB_PATH = join(DATA_DIR, 'homeslug.sqlite')

mkdirSync(dirname(DB_PATH), { recursive: true })

if (!existsSync(DB_PATH) && existsSync(LEGACY_DB_PATH)) {
  renameSync(LEGACY_DB_PATH, DB_PATH)
}

export const db = new Database(DB_PATH, { create: true })

db.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO app_meta (key, value)
  VALUES ('name', 'HomeLife'),
         ('welcome', 'Welcome to HomeLife');

  UPDATE app_meta SET value = 'HomeLife'
  WHERE key = 'name' AND value = 'HomeSlug';

  UPDATE app_meta SET value = 'Welcome to HomeLife'
  WHERE key = 'welcome' AND value = 'Welcome to HomeSlug';
`)

migrate(db)

/** ISO-8601 UTC timestamp string for TEXT columns. */
export function nowIso(): string {
  return new Date().toISOString()
}

/** Random UUID for TEXT primary keys. */
export function newId(): string {
  return crypto.randomUUID()
}

export function getMeta(key: string): string | null {
  const row = db
    .query('SELECT value FROM app_meta WHERE key = ?')
    .get(key) as { value: string } | null

  return row?.value ?? null
}
