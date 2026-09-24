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
      return { status: res.status, data, type: res.headers.get("content-type") ?? "" };
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
      ANTHROPIC_API_KEY: "",
      GITHUB_TOKEN: "",
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

  console.log("\n-- קישור, קהל יעד ותמונה --");
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  r = await admin.req("PATCH", `/projects/${p1}`, { link: "example.co.il" });
  check("קישור בלי סכימה מקבל https", r.status === 200 && r.data.link === "https://example.co.il/", dump(r));

  r = await admin.req("PATCH", `/projects/${p1}`, { link: "javascript:alert(1)" });
  check("קישור לא תקין -> 400", r.status === 400, dump(r));

  r = await admin.req("PATCH", `/projects/${p1}`, { audience: "בעלי עסקים קטנים, 35–55" });
  check("אפיון קהל יעד נשמר", r.status === 200 && r.data.audience.startsWith("בעלי עסקים"), dump(r));

  r = await admin.req("PATCH", `/projects/${p1}`, { image: PNG });
  check(
    "תמונה שהועלתה מוחזרת ככתובת ולא כתוכן",
    r.status === 200 && r.data.image_url === `/api/projects/${p1}/image` && !("image" in r.data),
    dump(r)
  );

  r = await admin.req("GET", `/projects/${p1}/image`);
  check("הגשת התמונה -> 200 image/png", r.status === 200 && r.type.startsWith("image/png"), dump({ status: r.status, type: r.type }));

  r = await admin.req("GET", "/projects");
  check(
    "רשימת הפרויקטים לא נושאת את גוף התמונה",
    r.status === 200 && r.data.every((p) => !("image" in p)),
    dump(r.data.map((p) => Object.keys(p)))
  );

  r = await admin.req("PATCH", `/projects/${p1}`, { image: "data:text/html;base64,PHNjcmlwdD4=" });
  check("data URI שאינו תמונה -> 400", r.status === 400, dump(r));

  r = await admin.req("PATCH", `/projects/${p1}`, { image: "" });
  check("הסרת תמונה -> 200", r.status === 200 && r.data.image_url === "", dump(r));

  r = await admin.req("GET", `/projects/${p1}/image`);
  check("אין תמונה -> 404", r.status === 404, dump(r));

  r = await admin.req("POST", "/ai/project-copy", { projectId: p1 });
  check("כתיבה אוטומטית בלי מפתח -> 503", r.status === 503, dump(r));

  r = await admin.req("POST", "/ai/project-copy", { projectId: "לא-קיים" });
  check("כתיבה אוטומטית לפרויקט לא קיים -> 404", r.status === 404, dump(r));

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

  // קו הייצור: פרויקט נוצר כטיוטה ושייך למנהל בלבד, גם למי שיש לו כבר
  // רשומת הרשאה מפורשת. רק אחרי שהמנהל מעביר אותו הוא נעשה גלוי.
  r = await member.req("GET", "/projects");
  check("טיוטה מוסתרת מאיש צוות למרות ההרשאה", r.status === 200 && r.data.length === 0, dump(r));

  r = await member.req("PATCH", `/projects/${p1}`, { description: "hack" });
  check("טיוטה לא נגישה גם לעדכון -> 404", r.status === 404, dump(r));

  r = await member.req("POST", `/projects/${p1}/handoff`, { stage: "done" });
  check("איש צוות לא מעביר פרויקט -> 403", r.status === 403, dump(r));

  r = await admin.req("POST", `/projects/${p1}/handoff`, { stage: "nope" });
  check("שלב לא חוקי -> 400", r.status === 400, dump(r));

  r = await admin.req("POST", `/projects/${p1}/handoff`, { stage: "marketing" });
  check("העברה בלי לבחור אדם -> 400", r.status === 400, dump(r));

  r = await admin.req("POST", `/projects/${p1}/handoff`, { stage: "done" });
  check("המנהל מוציא את הפרויקט מטיוטה -> 200", r.status === 200 && r.data.stage === "done", dump(r));

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

  console.log("\n-- העברה לשיווק ולמתכנת --");
  r = await admin.req("POST", "/users", { name: "רותי", password: "market123", role: "marketing" });
  check("יצירת איש שיווק -> 201", r.status === 201 && r.data.role === "marketing", dump(r));
  const marketerId = r.data.id;

  r = await admin.req("POST", "/users", { name: "יוסי", password: "devpass123", role: "wizard" });
  check("תפקיד לא חוקי -> 400", r.status === 400, dump(r));

  const marketer = jar();
  await marketer.req("POST", "/auth/member-login", { userId: marketerId, password: "market123" });

  r = await marketer.req("GET", "/projects");
  check("איש שיווק לא רואה פרויקט שלא הועבר אליו", r.status === 200 && r.data.length === 0, dump(r));

  r = await admin.req("POST", `/projects/${p2}/handoff`, { stage: "marketing", userId: marketerId });
  check(
    "העברה לשיווק -> 200",
    r.status === 200 && r.data.stage === "marketing" && r.data.assigned_to === marketerId,
    dump(r)
  );

  r = await marketer.req("GET", "/projects");
  check(
    "אחרי ההעברה איש השיווק רואה את הפרויקט עם הרשאת עריכה",
    r.status === 200 && r.data.length === 1 && r.data[0].id === p2 && r.data[0].level === "edit",
    dump(r)
  );

  r = await admin.req("POST", `/projects/${p2}/handoff`, { stage: "draft" });
  check("החזרה לטיוטה מנקה את השיוך", r.status === 200 && r.data.assigned_to === null, dump(r));

  r = await marketer.req("GET", "/projects");
  check("אחרי החזרה לטיוטה הפרויקט נעלם ממנו", r.status === 200 && r.data.length === 0, dump(r));

  console.log("\n-- הערות ותיקונים --");
  r = await admin.req("POST", `/projects/${p1}/notes`, { title: "  ", severity: "info" });
  check("הערה בלי כותרת -> 400", r.status === 400, dump(r));

  r = await admin.req("POST", `/projects/${p1}/notes`, { title: "לתקן את הטופס", severity: "bogus" });
  check("חומרה לא חוקית -> 400", r.status === 400, dump(r));

  r = await admin.req("POST", `/projects/${p1}/notes`, {
    title: "לתקן את הטופס",
    body: "שדה הטלפון לא נבדק",
    severity: "warning",
  });
  check("הוספת הערה -> 201", r.status === 201 && r.data.source === "manual" && !r.data.done, dump(r));
  const noteId = r.data.id;

  r = await admin.req("GET", "/projects");
  check(
    "מונה ההערות הפתוחות מופיע ברשימה",
    r.status === 200 && r.data.find((p) => p.id === p1).open_notes === 1,
    dump(r)
  );

  r = await member.req("POST", `/projects/${p1}/notes`, { title: "לא מורשה" });
  check("הרשאת צפייה לא מוסיפה הערה -> 403", r.status === 403, dump(r));

  r = await admin.req("PATCH", `/projects/${p1}/notes/${noteId}`, { done: true });
  check("סימון הערה כטופלה -> 200", r.status === 200 && r.data.done === true, dump(r));

  r = await admin.req("GET", "/projects");
  check(
    "הערה שטופלה יורדת מהמונה",
    r.status === 200 && r.data.find((p) => p.id === p1).open_notes === 0,
    dump(r)
  );

  r = await admin.req("GET", `/projects/${p1}/github`);
  check("ריפו לא מוגדר -> 400", r.status === 400, dump(r));

  r = await admin.req("PATCH", `/projects/${p1}`, { repo_url: "github.com/intellectcrm-dev/dshbord11" });
  check("שמירת קישור גיט", r.status === 200 && r.data.repo_url.includes("github.com"), dump(r));

  r = await admin.req("GET", `/projects/${p1}/github`);
  check("בלי GITHUB_TOKEN -> 503", r.status === 503, dump(r));

  r = await admin.req("GET", `/projects/${p1}/notes`);
  check(
    "רשימת ההערות מחזירה קבוצות ופריטים",
    r.status === 200 && Array.isArray(r.data.groups) && Array.isArray(r.data.notes),
    dump(r)
  );

  check(
    "הערה ידנית נשארת בלי שיוך לרשימה",
    r.data.notes.every((n) => n.group_id === null),
    dump(r.data.notes)
  );

  r = await admin.req("POST", `/projects/${p1}/notes`, { title: "בקבוצה זרה", groupId: "לא-קיים" });
  check("שיוך לרשימה שאינה קיימת -> 400", r.status === 400, dump(r));

  r = await admin.req("DELETE", `/projects/${p1}/notes/groups/לא-קיים`);
  check("מחיקת רשימה שאינה קיימת -> 404", r.status === 404, dump(r));

  console.log("\n-- רשימות מקובצות --");
  r = await admin.req("POST", `/projects/${p1}/notes/groups`, { title: "  " });
  check("רשימה בלי כותרת -> 400", r.status === 400, dump(r));

  r = await admin.req("POST", `/projects/${p1}/notes/groups`, {
    title: "תשתית — פעם אחת",
    note: "בלי אלה אי אפשר למסור ללקוח.",
  });
  check("פתיחת רשימה -> 201", r.status === 201 && r.data.position === 0, dump(r));
  const groupId = r.data.id;

  r = await admin.req("POST", `/projects/${p1}/notes/groups`, { title: "קליטה — לכל לקוח" });
  check("רשימה שנייה מקבלת מיקום עוקב", r.status === 201 && r.data.position === 1, dump(r));

  r = await admin.req("POST", `/projects/${p1}/notes`, {
    title: "להגדיר מפתח API",
    body: "בלעדיו אין כתיבה אוטומטית",
    severity: "critical",
    groupId,
  });
  check("הוספת פריט לרשימה -> 201", r.status === 201 && r.data.group_id === groupId, dump(r));
  const inGroupId = r.data.id;

  r = await admin.req("GET", `/projects/${p1}/notes`);
  check(
    "הרשימות חוזרות לפי סדר עם הפריטים שלהן",
    r.status === 200 &&
      r.data.groups.length === 2 &&
      r.data.groups[0].title === "תשתית — פעם אחת" &&
      r.data.notes.filter((n) => n.group_id === groupId).length === 1,
    dump(r)
  );

  r = await admin.req("PATCH", `/projects/${p1}/notes/${inGroupId}`, {
    title: "להגדיר מפתח API בפריסה",
    body: "מתוקן",
    severity: "warning",
    groupId: null,
  });
  check(
    "עריכת פריט: כותרת, תיאור, חומרה והוצאה מהרשימה",
    r.status === 200 &&
      r.data.title === "להגדיר מפתח API בפריסה" &&
      r.data.body === "מתוקן" &&
      r.data.severity === "warning" &&
      r.data.group_id === null,
    dump(r)
  );

  r = await admin.req("PATCH", `/projects/${p1}/notes/${inGroupId}`, { groupId });
  check("החזרת פריט לרשימה -> 200", r.status === 200 && r.data.group_id === groupId, dump(r));

  r = await admin.req("PATCH", `/projects/${p1}/notes/${inGroupId}`, { groupId: "לא-קיים" });
  check("העברה לרשימה שאינה קיימת -> 400", r.status === 400, dump(r));

  // PNG של פיקסל אחד.
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  r = await admin.req("PATCH", `/projects/${p1}/notes/${inGroupId}`, { image: pixel });
  check("צירוף תמונה לתיקון -> 200", r.status === 200 && r.data.image_url.includes("/image"), dump(r));
  const noteImageUrl = r.data.image_url;

  r = await admin.req("GET", noteImageUrl.replace(/^\/api/, ""));
  check("התמונה של התיקון מוגשת", r.status === 200, dump(r));

  r = await admin.req("PATCH", `/projects/${p1}/notes/${inGroupId}`, { image: "data:text/html;base64,PGI+" });
  check("תמונה שאינה תמונה -> 400", r.status === 400, dump(r));

  r = await admin.req("PATCH", `/projects/${p1}/notes/${inGroupId}`, { image: "" });
  check("הסרת תמונה מהתיקון", r.status === 200 && r.data.image_url === "", dump(r));

  r = await member.req("PATCH", `/projects/${p1}/notes/${inGroupId}`, { title: "לא מורשה" });
  check("הרשאת צפייה לא עורכת פריט -> 403", r.status === 403, dump(r));

  r = await member.req("POST", `/projects/${p1}/notes/groups`, { title: "לא מורשה" });
  check("הרשאת צפייה לא פותחת רשימה -> 403", r.status === 403, dump(r));

  r = await admin.req("DELETE", `/projects/${p1}/notes/groups/${groupId}`);
  check("מחיקת רשימה -> 200", r.status === 200, dump(r));

  r = await admin.req("GET", `/projects/${p1}/notes`);
  check(
    "מחיקת רשימה מוחקת גם את הפריטים שבה",
    r.status === 200 &&
      r.data.groups.length === 1 &&
      !r.data.notes.some((n) => n.id === inGroupId),
    dump(r)
  );

  r = await admin.req("POST", "/ai/checklist", { projectId: p1 });
  check("בניית רשימה בלי מפתח -> 503", r.status === 503, dump(r));

  r = await member.req("POST", "/ai/checklist", { projectId: p1 });
  check("הרשאת צפייה לא בונה רשימה -> 403", r.status === 403, dump(r));

  r = await admin.req("DELETE", `/projects/${p1}/notes/${noteId}`);
  check("מחיקת הערה -> 200", r.status === 200, dump(r));

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
