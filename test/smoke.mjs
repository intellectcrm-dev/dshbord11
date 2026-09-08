// בדיקת עשן מקצה לקצה מול ה-API האמיתי.
//
// אם מוגדר DATABASE_URL — הבדיקה יוצרת סכימה זמנית משלה באותו בסיס נתונים
// ומוחקת אותה בסוף, כך שנתונים אמיתיים לא נוגעים בה.
// אם לא — היא מרימה Postgres בזיכרון (PGlite) ומריצה מולו, בלי שום תלות חיצונית.
import "dotenv/config";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.TEST_PORT) || 4100;
const PG_PORT = Number(process.env.TEST_PG_PORT) || 5439;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_PASSWORD = "admin1234";

let passed = 0;
let failed = 0;
let server;
let pglite;
let pgliteServer;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}
const dump = (r) => JSON.stringify(r);

// כל "דפדפן" בבדיקה הוא צנצנת עוגיות משלו.
function jar() {
  let cookie = "";
  return {
    async req(method, path, body) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        if (pair.startsWith("pd_session=")) cookie = pair.endsWith("=") ? "" : pair;
      }
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, data };
    },
  };
}

async function startDatabase() {
  if (process.env.DATABASE_URL) {
    const schema = `smoke_${randomUUID().slice(0, 8)}`;
    console.log(`בסיס נתונים: DATABASE_URL, סכימה זמנית ${schema}`);
    return { databaseUrl: process.env.DATABASE_URL, schema, poolMax: "3", external: true };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  pglite = await PGlite.create();
  pgliteServer = new PGLiteSocketServer({ db: pglite, port: PG_PORT, host: "127.0.0.1" });
  await pgliteServer.start();
  console.log(`בסיס נתונים: PGlite בזיכרון על פורט ${PG_PORT}`);
  // PGlite מקבל חיבור אחד בכל רגע, ולכן pool של חיבור בודד.
  return {
    databaseUrl: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`,
    schema: "public",
    poolMax: "1",
    external: false,
  };
}

async function stopDatabase(db) {
  if (db?.external) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: db.databaseUrl });
    try {
      await client.connect();
      await client.query(`DROP SCHEMA IF EXISTS "${db.schema}" CASCADE`);
      console.log(`הסכימה הזמנית ${db.schema} נמחקה`);
    } catch (err) {
      console.error(`מחיקת הסכימה הזמנית ${db.schema} נכשלה:`, err.message);
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }
  await pgliteServer?.stop().catch(() => {});
  await pglite?.close().catch(() => {});
}

function startServer(db) {
  let output = "";
  server = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(PORT),
      DATABASE_URL: db.databaseUrl,
      DB_SCHEMA: db.schema,
      PG_POOL_MAX: db.poolMax,
      JWT_SECRET: "smoke-test-secret",
      ADMIN_PASSWORD,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (output += d));
  server.stderr.on("data", (d) => (output += d));
  return () => output;
}

async function waitForServer(readOutput) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`השרת נפל בעלייה:\n${readOutput()}`);
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* עדיין לא מאזין */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`השרת לא עלה תוך 30 שניות:\n${readOutput()}`);
}

let db;
try {
  db = await startDatabase();
  const readOutput = startServer(db);
  await waitForServer(readOutput);

  const admin = jar();
  const member = jar();
  const anon = jar();

  console.log("\n-- אימות --");
  let r = await anon.req("GET", "/projects");
  check("בקשה ללא חיבור -> 401", r.status === 401, dump(r));

  r = await admin.req("POST", "/auth/admin-login", { password: "wrong-pass" });
  check("סיסמת מנהל שגויה -> 401", r.status === 401, dump(r));

  r = await admin.req("POST", "/auth/admin-login", { password: ADMIN_PASSWORD });
  check("כניסת מנהל -> 200", r.status === 200 && r.data.user.role === "admin", dump(r));

  r = await admin.req("GET", "/auth/me");
  check("/auth/me מחזיר מנהל", r.status === 200 && r.data.user.role === "admin", dump(r));

  console.log("\n-- פרויקטים (מנהל) --");
  r = await admin.req("POST", "/projects", { name: "אתר חדש" });
  check("יצירת פרויקט -> 201", r.status === 201 && r.data.level === "admin", dump(r));
  const p1 = r.data.id;

  r = await admin.req("POST", "/projects", { name: "   " });
  check("שם ריק -> 400", r.status === 400, dump(r));

  r = await admin.req("POST", "/projects", { name: "פרויקט שני" });
  const p2 = r.data.id;

  r = await admin.req("PATCH", `/projects/${p1}`, { progress: 150 });
  check("התקדמות מחוץ לטווח -> 400", r.status === 400, dump(r));

  r = await admin.req("PATCH", `/projects/${p1}`, { status: "nope" });
  check("סטטוס לא חוקי -> 400", r.status === 400, dump(r));

  r = await admin.req("PATCH", `/projects/${p1}`, { progress: 40, status: "blocked", description: "בבדיקה" });
  check("עדכון על ידי מנהל -> 200", r.status === 200 && r.data.progress === 40 && r.data.status === "blocked", dump(r));

  console.log("\n-- משתמשים והרשאות --");
  r = await admin.req("POST", "/users", { name: "דנה", password: "123" });
  check("סיסמת איש צוות קצרה -> 400", r.status === 400, dump(r));

  r = await admin.req("POST", "/users", { name: "דנה", password: "member123" });
  check("יצירת איש צוות -> 201", r.status === 201, dump(r));
  const memberId = r.data.id;

  r = await anon.req("GET", "/auth/members");
  check(
    "רשימת השמות הציבורית חושפת id ושם בלבד",
    r.status === 200 && r.data.length === 1 && Object.keys(r.data[0]).sort().join() === "id,name",
    dump(r)
  );

  r = await admin.req("PUT", "/permissions", { userId: memberId, projectId: p1, level: "bogus" });
  check("רמת הרשאה לא חוקית -> 400", r.status === 400, dump(r));

  r = await admin.req("PUT", "/permissions", { userId: memberId, projectId: p1, level: "view" });
  check("מתן הרשאת צפייה -> 200", r.status === 200, dump(r));

  console.log("\n-- איש צוות --");
  r = await member.req("POST", "/auth/member-login", { userId: memberId, password: "nope-nope" });
  check("סיסמת איש צוות שגויה -> 401", r.status === 401, dump(r));

  r = await member.req("POST", "/auth/member-login", { userId: memberId, password: "member123" });
  check("כניסת איש צוות -> 200", r.status === 200 && r.data.user.role === "member", dump(r));

  r = await member.req("GET", "/projects");
  check(
    "איש צוות רואה רק את מה שהוקצה לו",
    r.status === 200 && r.data.length === 1 && r.data[0].id === p1 && r.data[0].level === "view",
    dump(r)
  );

  r = await member.req("PATCH", `/projects/${p1}`, { description: "hack" });
  check("הרשאת צפייה לא מאפשרת עריכה -> 403", r.status === 403, dump(r));

  r = await member.req("PATCH", `/projects/${p2}`, { description: "hack" });
  check("פרויקט שלא הוקצה מוסתר -> 404", r.status === 404, dump(r));

  r = await member.req("GET", "/users");
  check("איש צוות לא רואה משתמשים -> 403", r.status === 403, dump(r));

  r = await member.req("POST", "/projects", { name: "x" });
  check("איש צוות לא יוצר פרויקט -> 403", r.status === 403, dump(r));

  r = await member.req("DELETE", `/projects/${p1}`);
  check("איש צוות לא מוחק פרויקט -> 403", r.status === 403, dump(r));

  r = await member.req("PUT", "/permissions", { userId: memberId, projectId: p2, level: "edit" });
  check("איש צוות לא מעניק לעצמו הרשאה -> 403", r.status === 403, dump(r));

  r = await admin.req("PUT", "/permissions", { userId: memberId, projectId: p1, level: "edit" });
  check("שדרוג להרשאת עריכה -> 200", r.status === 200, dump(r));

  r = await member.req("PATCH", `/projects/${p1}`, { description: "עודכן על ידי דנה", progress: 70 });
  check("הרשאת עריכה מאפשרת עדכון -> 200", r.status === 200 && r.data.progress === 70, dump(r));

  r = await member.req("PATCH", `/projects/${p1}`, { name: "שם חדש" });
  check("איש צוות לא משנה שם פרויקט -> 403", r.status === 403, dump(r));

  console.log("\n-- שינוי סיסמת מנהל --");
  r = await admin.req("PUT", "/admin/password", { newPassword: "short" });
  check("סיסמת מנהל קצרה -> 400", r.status === 400, dump(r));

  r = await admin.req("PUT", "/admin/password", { newPassword: "brand-new-admin-pass" });
  check("שינוי סיסמת מנהל -> 200", r.status === 200, dump(r));

  r = await admin.req("GET", "/projects");
  check("החיבור הנוכחי של המנהל שורד את השינוי", r.status === 200, dump(r));

  const other = jar();
  r = await other.req("POST", "/auth/admin-login", { password: ADMIN_PASSWORD });
  check("הסיסמה הישנה נדחית -> 401", r.status === 401, dump(r));

  r = await other.req("POST", "/auth/admin-login", { password: "brand-new-admin-pass" });
  check("הסיסמה החדשה מתקבלת -> 200", r.status === 200, dump(r));

  console.log("\n-- מחיקות --");
  r = await admin.req("DELETE", `/users/${memberId}`);
  check("מחיקת איש צוות -> 200", r.status === 200, dump(r));

  r = await member.req("GET", "/projects");
  check("החיבור של משתמש שנמחק מתבטל -> 401", r.status === 401, dump(r));

  r = await admin.req("DELETE", `/projects/${p2}`);
  check("מחיקת פרויקט -> 200", r.status === 200, dump(r));

  r = await admin.req("DELETE", `/projects/${p2}`);
  check("מחיקת פרויקט שאינו קיים -> 404", r.status === 404, dump(r));

  console.log("\n-- הגבלת קצב --");
  const brute = jar();
  let last;
  for (let i = 0; i < 6; i++) {
    last = await brute.req("POST", "/auth/admin-login", { password: `guess-${i}` });
  }
  check("ניסיון כניסה שישי נחסם -> 429", last.status === 429, dump(last));

  console.log("\n-- יציאה --");
  r = await admin.req("POST", "/auth/logout");
  check("יציאה -> 200", r.status === 200, dump(r));

  r = await admin.req("GET", "/projects");
  check("אחרי יציאה אין גישה -> 401", r.status === 401, dump(r));

  console.log(`\n${passed} עברו, ${failed} נכשלו\n`);
} catch (err) {
  console.error(err.message);
  failed++;
} finally {
  server?.kill();
  await new Promise((r) => setTimeout(r, 300));
  await stopDatabase(db);
}

process.exit(failed ? 1 : 0);
