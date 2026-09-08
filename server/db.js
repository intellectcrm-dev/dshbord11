import pg from "pg";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const { Pool } = pg;

// כל העבודה מתבצעת בתוך סכימה אחת. ברירת המחדל public, והבדיקות מקבלות
// סכימה זמנית משלהן כדי לא לגעת בנתונים אמיתיים.
export const SCHEMA = process.env.DB_SCHEMA || "public";
const quotedSchema = `"${SCHEMA.replace(/"/g, '""')}"`;

// ה-pool נבנה בשימוש הראשון ולא בטעינת המודול. על serverless חריגה בזמן
// import מפילה את הפונקציה כולה, והפלטפורמה מחזירה דף שגיאה גנרי שלא מסביר
// דבר; כך הבקשה נכשלת עם הודעה ברורה ו-/api/health עדיין מסוגל לענות.
let pool;

function createPool() {
  // ערך שהודבק בממשק ניהול עלול לגרור רווחים בקצוות.
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL חסר. העתק את .env.example ל-.env ומלא את מחרוזת החיבור ל-Postgres (ראה README)."
    );
  }

  // pool קטן בכוונה: על Vercel כל instance מחזיק pool משלו, ומול ספק מנוהל
  // עדיף להתחבר דרך ה-endpoint המאגד (pooled) עם מעט חיבורים לכל instance.
  const created = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX) || 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });

  created.on("connect", (client) => {
    client.query(`SET search_path TO ${quotedSchema}`).catch(() => {
      /* מטופל בשאילתה הבאה שתיכשל בקול */
    });
  });

  created.on("error", (err) => {
    console.error("שגיאת pool של Postgres:", err.message);
  });

  return created;
}

export function getPool() {
  return (pool ??= createPool());
}

export async function closePool() {
  const current = pool;
  pool = undefined;
  await current?.end();
}

export const query = (text, params) => getPool().query(text, params);
export const one = async (text, params) => (await getPool().query(text, params)).rows[0] ?? null;
export const all = async (text, params) => (await getPool().query(text, params)).rows;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','member')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','blocked')),
    progress    INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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

  -- מוני ניסיונות כניסה. בשרת אחד אפשר היה להחזיק אותם בזיכרון, אבל על
  -- serverless כל בקשה עלולה לנחות ב-instance אחר, ואז נעילה בזיכרון חסרת ערך.
  CREATE TABLE IF NOT EXISTS login_attempts (
    key          TEXT PRIMARY KEY,
    attempts     INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ
  );

  -- שדות שנוספו אחרי הגרסה הראשונה. ‎CREATE TABLE IF NOT EXISTS לא נוגע
  -- בטבלה קיימת, ולכן ההרחבות נכתבות בנפרד ורצות שוב ושוב בלי נזק.
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS link     TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS image    TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT '';

  -- קו הייצור: הפרויקט מתחיל אצל המנהל ועובר הלאה. מה שנשאר draft גלוי
  -- למנהל בלבד, ולכן שלב הוא נתון של הפרויקט ולא הרשאה של משתמש.
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_url    TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief       TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage       TEXT NOT NULL DEFAULT 'draft';
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_to TEXT;
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS handed_at   TIMESTAMPTZ;

  ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_stage_check;
  ALTER TABLE projects ADD  CONSTRAINT projects_stage_check
    CHECK (stage IN ('draft','marketing','dev','done'));

  ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_assigned_to_fkey;
  ALTER TABLE projects ADD  CONSTRAINT projects_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;

  -- התפקידים החדשים. האילוץ נכתב מחדש כי הוא נוצר עם רשימה קצרה יותר.
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD  CONSTRAINT users_role_check
    CHECK (role IN ('admin','member','marketing','developer'));

  -- הערה, באג או משימה. שלושת מקורות הסריקה נכנסים לאותה טבלה: מה שנוסף
  -- ביד, מה שנמשך מ-GitHub, ומה שקלוד מצא בקוד.
  CREATE TABLE IF NOT EXISTS project_notes (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source     TEXT NOT NULL CHECK (source IN ('manual','github','ai')),
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    url        TEXT NOT NULL DEFAULT '',
    severity   TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
    done       BOOLEAN NOT NULL DEFAULT false,
    external_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- רשימת מסירה מקובצת: קבוצה נושאת כותרת, הסבר וסדר, והפריטים תלויים בה.
  -- הערה שנוספה ביד נשארת בלי קבוצה ומוצגת תחת «כללי».
  CREATE TABLE IF NOT EXISTS project_note_groups (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_note_groups_project ON project_note_groups(project_id);

  ALTER TABLE project_notes ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE project_notes ADD COLUMN IF NOT EXISTS group_id TEXT;

  ALTER TABLE project_notes DROP CONSTRAINT IF EXISTS project_notes_group_id_fkey;
  ALTER TABLE project_notes ADD  CONSTRAINT project_notes_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES project_note_groups(id) ON DELETE CASCADE;

  CREATE INDEX IF NOT EXISTS idx_notes_project ON project_notes(project_id);

  -- סנכרון חוזר מ-GitHub לא אמור לשכפל את אותו issue.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_external
    ON project_notes(project_id, source, external_id)
    WHERE external_id <> '';
`;

async function seedAdmin(client) {
  const existing = await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing.rowCount > 0) return null;

  const password = process.env.ADMIN_PASSWORD || "admin1234";
  const id = randomUUID();
  await client.query(
    "INSERT INTO users (id, name, password_hash, role) VALUES ($1, $2, $3, 'admin')",
    [id, process.env.ADMIN_NAME || "מנהל", bcrypt.hashSync(password, 12)]
  );

  return { id, usedDefaultPassword: !process.env.ADMIN_PASSWORD };
}

async function initialize() {
  const client = await getPool().connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}`);
    await client.query("BEGIN");
    // שני cold starts במקביל ירוצו כאן בזה אחר זה ולא יתנגשו על יצירת הטבלאות.
    await client.query("SELECT pg_advisory_xact_lock(918273645)");
    await client.query(SCHEMA_SQL);
    const seeded = await seedAdmin(client);
    await client.query("COMMIT");

    if (seeded?.usedDefaultPassword) {
      console.log("\n★ נוצר חשבון מנהל עם סיסמת ברירת המחדל admin1234.");
      console.log("  החלף אותה במסך «צוות והרשאות» מיד אחרי הכניסה הראשונה.\n");
    } else if (seeded) {
      console.log("★ נוצר חשבון מנהל עם הסיסמה שהוגדרה ב-ADMIN_PASSWORD.");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// יצירת הסכימה וזריעת המנהל רצות פעם אחת לכל instance, ולא בכל בקשה.
let readyPromise;
export function ensureReady() {
  readyPromise ??= initialize().catch((err) => {
    readyPromise = undefined; // כישלון זמני (למשל DB שישן) לא ינעל את התהליך
    throw err;
  });
  return readyPromise;
}

export { randomUUID as uid };
