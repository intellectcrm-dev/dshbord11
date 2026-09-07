// בדיקת עשן מקצה לקצה מול ה-API האמיתי.
// מרימה שרת על פורט נפרד עם בסיס נתונים זמני, בודקת, ומנקה אחריה.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.TEST_PORT) || 4100;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_PASSWORD = "admin1234";

const tmp = mkdtempSync(join(tmpdir(), "pd-smoke-"));
const server = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(PORT),
    DB_FILE: join(tmp, "test.db"),
    JWT_SECRET: "smoke-test-secret",
    ADMIN_PASSWORD,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (d) => (serverOutput += d));
server.stderr.on("data", (d) => (serverOutput += d));

function cleanup() {
  server.kill();
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* the OS will reclaim it */
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) {
      throw new Error(`השרת נפל בעלייה:\n${serverOutput}`);
    }
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`השרת לא עלה תוך 15 שניות:\n${serverOutput}`);
}

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

let passed = 0;
let failed = 0;
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

try {
  await waitForServer();

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
  cleanup();
}

process.exit(failed ? 1 : 0);
