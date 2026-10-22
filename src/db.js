import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = process.env.DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'therapezy.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client','psychologist')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS psychologists (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'Psychologist',
  registration_no TEXT DEFAULT '',
  photo_url TEXT DEFAULT '',
  gender TEXT DEFAULT 'Prefer not to say',
  age INTEGER,
  orientation TEXT DEFAULT 'Prefer not to say',
  religion TEXT DEFAULT 'Prefer not to say',
  ethnicity TEXT DEFAULT 'Prefer not to say',
  languages TEXT DEFAULT '["English"]',
  specialties TEXT DEFAULT '[]',
  modalities TEXT DEFAULT '[]',
  bio TEXT DEFAULT '',
  clinic_name TEXT DEFAULT '',
  address TEXT DEFAULT '',
  lat REAL, lng REAL,
  fee INTEGER,
  telehealth INTEGER DEFAULT 0,
  accepting INTEGER DEFAULT 1,
  published INTEGER DEFAULT 0,
  booking_type TEXT DEFAULT 'none',
  booking_url TEXT DEFAULT '',
  booking_api_base TEXT DEFAULT '',
  booking_api_key TEXT DEFAULT '',
  booking_practitioner_id TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS swipes (
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psych_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dir TEXT NOT NULL CHECK (dir IN ('like','pass')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_id, psych_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psych_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, psych_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conv_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, id);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psych_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start TEXT NOT NULL,
  end TEXT,
  external_ref TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export const parse = (s, fallback) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };
