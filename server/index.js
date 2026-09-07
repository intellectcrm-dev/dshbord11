import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { seedAdmin } from "./db.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import userRoutes from "./routes/users.js";
import permissionRoutes from "./routes/permissions.js";
import adminRoutes from "./routes/admin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
const isProd = process.env.NODE_ENV === "production";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/users", userRoutes);
app.use("/api/permissions", permissionRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api", (req, res) => res.status(404).json({ error: "לא נמצא" }));

// In production the built client is served from the same origin, which keeps
// the session cookie first-party. In development Vite serves it on :5173 and
// proxies /api here.
const clientDist = resolve(__dirname, "../client/dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/.*/, (req, res) => res.sendFile(join(clientDist, "index.html")));
} else if (isProd) {
  console.warn("⚠ client/dist לא נמצא — הרץ `npm run build` לפני הפעלה ב-production");
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "שגיאת שרת" });
});

const seeded = seedAdmin();
if (seeded && !seeded.fromEnv) {
  console.log(`\n★ נוצר חשבון מנהל. סיסמה ראשונית: ${seeded.password}`);
  console.log("  החלף אותה במסך «צוות והרשאות» מיד אחרי הכניסה הראשונה.\n");
}

app.listen(PORT, () => {
  console.log(`שרת פועל על http://localhost:${PORT}`);
  if (!isProd) console.log(`ממשק פיתוח: http://localhost:5173`);
});
