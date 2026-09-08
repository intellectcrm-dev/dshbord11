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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
const isProd = process.env.NODE_ENV === "production";
const isServerless = Boolean(process.env.VERCEL);

const app = express();
app.set("trust proxy", 1);
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "שגיאת שרת" });
});

if (!isServerless) {
  app.listen(PORT, () => {
    console.log(`שרת פועל על http://localhost:${PORT}`);
    if (!isProd) console.log("ממשק פיתוח: http://localhost:5173");
  });
}

export default app;
