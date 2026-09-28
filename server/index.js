import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureReady, SCHEMA } from "./db.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import userRoutes from "./routes/users.js";
import permissionRoutes from "./routes/permissions.js";
import adminRoutes from "./routes/admin.js";
import aiRoutes from "./routes/ai.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
const isProd = process.env.NODE_ENV === "production";
const isServerless = Boolean(process.env.VERCEL);

const app = express();
app.set("trust proxy", 1);
// העלאת תמונה נשלחת כ-data URI בגוף הבקשה, ולכן נתיב הפרויקטים לבדו מקבל
// תקרה גדולה. body-parser מדלג על גוף שכבר נקרא, כך שהתקרה הכללית שאחריו
// עדיין חלה על כל שאר הנתיבים.
app.use("/api/projects", express.json({ limit: "3mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// משתני הסביבה שבלעדיהם השרת לא יכול לעבוד כלל.
const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET"];

// בדיקת הבריאות רשומה לפני ensureReady ולכן עונה גם כשהתצורה שבורה. זו
// הדרך לאבחן פריסה מרחוק: היא מדווחת אילו משתנים הוגדרו (כן/לא בלבד, בלי
// ערכים) ואם החיבור לבסיס הנתונים עלה, במקום להיכשל מאחורי דף שגיאה גנרי.
app.get("/api/health", async (req, res) => {
  const env = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, Boolean(process.env[name]?.trim())])
  );
  const missing = REQUIRED_ENV.filter((name) => !env[name]);

  if (missing.length > 0) {
    return res.status(503).json({
      ok: false,
      env,
      error: `חסרים משתני סביבה: ${missing.join(", ")}. הגדר אותם והרץ פריסה מחדש.`,
    });
  }

  try {
    await ensureReady();
    res.json({ ok: true, env, db: "ok", schema: SCHEMA });
  } catch (err) {
    res.status(503).json({ ok: false, env, db: "failed", error: err.message });
  }
});

// יצירת הסכימה וזריעת המנהל קורות פעם אחת לכל instance, בבקשה הראשונה שמגיעה.
app.use("/api", (req, res, next) => {
  ensureReady().then(() => next(), next);
});

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/users", userRoutes);
app.use("/api/permissions", permissionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai", aiRoutes);

app.use("/api", (req, res) => res.status(404).json({ error: "לא נמצא" }));

// בהרצה עצמאית השרת מגיש גם את הקליינט הבנוי, כך שהעוגייה נשארת first-party.
// על Vercel הקבצים הסטטיים מוגשים מה-CDN והפונקציה מטפלת רק ב-/api.
const clientDist = resolve(__dirname, "../client/dist");
if (!isServerless && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/.*/, (req, res) => res.sendFile(join(clientDist, "index.html")));
} else if (isProd && !isServerless) {
  console.warn("⚠ client/dist לא נמצא — הרץ `npm run build` לפני הפעלה ב-production");
}

// תקלות תצורה וחיבור לבסיס הנתונים מתוארות במפורש, כדי שמסך הכניסה יסביר
// מה חסר בפריסה במקום «שגיאת שרת» אילמת. שגיאות אחרות נשארות כלליות.
const DB_FAILURES = {
  ECONNREFUSED: "בסיס הנתונים דחה את החיבור",
  ENOTFOUND: "כתובת בסיס הנתונים ב-DATABASE_URL לא נמצאה",
  ETIMEDOUT: "החיבור לבסיס הנתונים לא הגיב בזמן",
  "28P01": "שם המשתמש או הסיסמה ב-DATABASE_URL שגויים",
  "3D000": "בסיס הנתונים שב-DATABASE_URL לא קיים",
};

app.use((err, req, res, next) => {
  console.error(err);
  if (err.expose) return res.status(503).json({ error: err.message });

  const db = DB_FAILURES[err.code] ?? (/timeout|terminated/i.test(err.message) ? DB_FAILURES.ETIMEDOUT : null);
  if (db) return res.status(503).json({ error: `${db}. בדוק את /api/health` });

  res.status(500).json({ error: "שגיאת שרת. בדוק את /api/health" });
});

if (!isServerless) {
  app.listen(PORT, () => {
    console.log(`שרת פועל על http://localhost:${PORT}`);
    if (!isProd) console.log("ממשק פיתוח: http://localhost:5173");
  });
}

export default app;
