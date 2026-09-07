import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import bcrypt from "bcryptjs";

const DB_FILE = resolve(process.env.DB_FILE || "data/dashboard.db");
mkdirSync(dirname(DB_FILE), { recursive: true });

export const db = new DatabaseSync(DB_FILE);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','member')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','blocked')),
    progress    INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_permissions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    level      TEXT NOT NULL CHECK (level IN ('view','edit')),
    UNIQUE (user_id, project_id)
  );

  CREATE INDEX IF NOT EXISTS idx_perm_user ON project_permissions(user_id);
  CREATE INDEX IF NOT EXISTS idx_perm_project ON project_permissions(project_id);
`);

// Seed the first admin on an empty database. The password comes from the
// environment when provided, otherwise a default that the README tells the
// user to change on first login.
export function seedAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existing) return null;

  const password = process.env.ADMIN_PASSWORD || "admin1234";
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users (id, name, password_hash, role) VALUES (?, ?, ?, 'admin')"
  ).run(id, process.env.ADMIN_NAME || "מנהל", bcrypt.hashSync(password, 12));

  return { id, password, fromEnv: Boolean(process.env.ADMIN_PASSWORD) };
}

export { randomUUID as uid };
