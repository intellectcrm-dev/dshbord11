import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { one, query } from "./db.js";

const COOKIE_NAME = "pd_session";
const TOKEN_TTL = process.env.SESSION_TTL || "8h";
const isProd = process.env.NODE_ENV === "production";
const isServerless = Boolean(process.env.VERCEL);

export const JWT_SECRET = resolveSecret();

// בפריסה אמיתית המפתח חייב להגיע מהסביבה: על serverless אין דיסק משותף,
// ומפתח שנוצר לכל instance בנפרד היה מנתק משתמשים באקראי.
// בפיתוח מקומי שומרים מפתח בקובץ כדי שהפעלה מחדש לא תנתק את מי שמחובר.
function resolveSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isProd || isServerless) {
    throw new Error("JWT_SECRET חייב להיות מוגדר בפריסה (ראה .env.example)");
  }
  const file = "data/.jwt-secret";
  mkdirSync("data", { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString("hex"), "utf8");
  return readFileSync(file, "utf8").trim();
}

// טביעת אצבע של ה-hash השמור. היא נוסעת בתוך הטוקן, ולכן שינוי סיסמה
// מבטל מיידית כל טוקן שהונפק לפניו.
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
    secure: isProd || isServerless,
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd || isServerless,
    path: "/",
  });
}

async function currentUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }

  const user = await one("SELECT * FROM users WHERE id = $1", [payload.sub]);
  if (!user) return null;
  if (payload.pw !== pwFingerprint(user.password_hash)) return null;
  return user;
}

export async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) {
      clearSession(res);
      return res.status(401).json({ error: "לא מחובר" });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "נדרשות הרשאות מנהל" });
  }
  next();
}

// 'admin' | 'edit' | 'view' | null — מקור האמת היחיד לגישה.
// כל route שנוגע בפרויקט שואל את זה, אף פעם לא את הקליינט.
export async function permissionFor(user, projectId) {
  if (user.role === "admin") return "admin";
  const row = await one(
    "SELECT level FROM project_permissions WHERE user_id = $1 AND project_id = $2",
    [user.id, projectId]
  );
  return row?.level ?? null;
}

export function canEdit(level) {
  return level === "admin" || level === "edit";
}

// ---- הגבלת ניסיונות כניסה ------------------------------------------------
const MAX_ATTEMPTS = 5;
const WINDOW = "15 minutes";
const LOCK = "15 minutes";

export async function loginGuard(key) {
  const row = await one(
    "SELECT locked_until FROM login_attempts WHERE key = $1 AND locked_until > now()",
    [key]
  );
  if (!row) return { blocked: false };
  return {
    blocked: true,
    retryInSec: Math.max(1, Math.ceil((new Date(row.locked_until) - Date.now()) / 1000)),
  };
}

export async function registerFailure(key) {
  // חלון גולש: ניסיון שמגיע אחרי שהחלון הקודם פג פותח ספירה חדשה.
  const row = await one(
    `INSERT INTO login_attempts (key, attempts, window_start)
     VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       attempts = CASE
         WHEN login_attempts.window_start < now() - interval '${WINDOW}' THEN 1
         ELSE login_attempts.attempts + 1
       END,
       window_start = CASE
         WHEN login_attempts.window_start < now() - interval '${WINDOW}' THEN now()
         ELSE login_attempts.window_start
       END
     RETURNING attempts`,
    [key]
  );

  if (row.attempts >= MAX_ATTEMPTS) {
    await query(
      `UPDATE login_attempts
          SET locked_until = now() + interval '${LOCK}', attempts = 0, window_start = now()
        WHERE key = $1`,
      [key]
    );
  }
}

export async function clearFailures(key) {
  await query("DELETE FROM login_attempts WHERE key = $1", [key]);
}
