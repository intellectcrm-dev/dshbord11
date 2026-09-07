import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { db } from "./db.js";

const COOKIE_NAME = "pd_session";
const TOKEN_TTL = process.env.SESSION_TTL || "8h";
const isProd = process.env.NODE_ENV === "production";

export const JWT_SECRET = resolveSecret();

// In production the secret must come from the environment. In development we
// keep a generated one on disk, so that restarting the server (or `--watch`
// reloading it) does not sign everybody out.
function resolveSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isProd) {
    throw new Error("JWT_SECRET חייב להיות מוגדר בסביבת production (ראה .env.example)");
  }
  const file = resolve(dirname(process.env.DB_FILE || "data/dashboard.db"), ".jwt-secret");
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString("hex"), "utf8");
  return readFileSync(file, "utf8").trim();
}

// Fingerprint of the stored password hash. It travels inside the token so that
// changing a password immediately invalidates every session issued before it.
function pwFingerprint(passwordHash) {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function issueSession(res, user) {
  const token = jwt.sign(
    { sub: user.id, role: user.role, pw: pwFingerprint(user.password_hash) },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: isProd, path: "/" });
}

function currentUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
  if (!user) return null;
  if (payload.pw !== pwFingerprint(user.password_hash)) return null;
  return user;
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    clearSession(res);
    return res.status(401).json({ error: "לא מחובר" });
  }
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "נדרשות הרשאות מנהל" });
  }
  next();
}

// 'admin' | 'edit' | 'view' | null — the single source of truth for access.
// Every route that touches a project asks this, never the client.
export function permissionFor(user, projectId) {
  if (user.role === "admin") return "admin";
  const row = db
    .prepare("SELECT level FROM project_permissions WHERE user_id = ? AND project_id = ?")
    .get(user.id, projectId);
  return row?.level ?? null;
}

export function canEdit(level) {
  return level === "admin" || level === "edit";
}

// ---- login throttling -------------------------------------------------
// In-memory on purpose: a single-process deployment, and a restart clearing
// the counters is an acceptable trade-off for having no extra dependency.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map();

export function loginGuard(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec?.lockedUntil && rec.lockedUntil > now) {
    return { blocked: true, retryInSec: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  return { blocked: false };
}

export function registerFailure(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCK_MS;
    rec.count = 0;
    rec.firstAt = now;
  }
}

export function clearFailures(key) {
  attempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of attempts) {
    if (now - rec.firstAt > WINDOW_MS && (!rec.lockedUntil || rec.lockedUntil < now)) {
      attempts.delete(key);
    }
  }
}, WINDOW_MS).unref();
