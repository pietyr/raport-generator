import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../data')

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
export const DB_PATH = path.join(DATA_DIR, 'db.sqlite')

fs.mkdirSync(UPLOADS_DIR, { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    event_url TEXT NOT NULL DEFAULT '',
    template_path TEXT,
    background_path TEXT,
    stats_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tiers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tier_id TEXT NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    category INTEGER,
    excluded INTEGER NOT NULL DEFAULT 0,
    tagged_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS photo_partners (
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    PRIMARY KEY (photo_id, partner_id)
  );

  CREATE TABLE IF NOT EXISTS photo_tiers (
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    tier_id TEXT NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
    PRIMARY KEY (photo_id, tier_id)
  );
`)

export function projectDir(projectId: string) {
  const dir = path.join(UPLOADS_DIR, projectId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function withTransaction(fn: () => void) {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
