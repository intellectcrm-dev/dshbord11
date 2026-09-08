import { Router } from "express";
import { all, one, query, uid } from "../db.js";
import { requireAuth, requireAdmin, permissionFor, canEdit } from "../auth.js";

const router = Router();
const STATUSES = ["active", "paused", "done", "blocked"];

// תמונה שהועלתה נשמרת כ-data URI בעמודה image. היא יכולה לשקול מאות
// קילובייטים, ולכן היא לא נשלחת ברשימת הפרויקטים: הלקוח מקבל image_url —
// כתובת חיצונית כמות שהיא, או נתיב לתמונה השמורה שמוגש בבקשה נפרדת.
const PROJECT_COLUMNS = `p.id, p.name, p.description, p.status, p.progress,
    p.link, p.audience, p.created_by, p.created_at, p.updated_at,
    CASE WHEN p.image = ''            THEN ''
         WHEN p.image LIKE 'data:%'   THEN '/api/projects/' || p.id || '/image'
         ELSE p.image
    END AS image_url`;

// גודל מרבי של data URI. תואם להקטנה שהלקוח מבצע לפני השליחה, ומשאיר מרווח
// לתקרת הגוף (3mb) שמוגדרת ל-/api/projects ב-server/index.js.
const MAX_IMAGE_CHARS = 1_400_000;
const MAX_LINK_CHARS = 2000;
const MAX_AUDIENCE_CHARS = 2000;

const fetchProject = (id) =>
  one(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = $1`, [id]);

// מחזיר כתובת מנורמלת, "" לשדה ריק, או null אם הקלט אינו כתובת קבילה.
function normalizeLink(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > MAX_LINK_CHARS) return null;

  // מי שמקליד "example.com" מתכוון ל-https, ואין סיבה להכשיל אותו על כך.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

// מקבל data URI של תמונה או כתובת חיצונית. כל דבר אחר נדחה — הערך הזה
// מוגש בחזרה כתמונה, ו-data URI מסוג אחר היה מאפשר הזרקת תוכן.
function normalizeImage(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > MAX_IMAGE_CHARS) return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(raw)) return raw;
  return normalizeLink(raw);
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  if (req.user.role === "admin") {
    const rows = await all(
      `SELECT ${PROJECT_COLUMNS} FROM projects p ORDER BY p.created_at`
    );
    return res.json(rows.map((p) => ({ ...p, level: "admin" })));
  }

  const rows = await all(
    `SELECT ${PROJECT_COLUMNS}, pp.level
       FROM projects p
       JOIN project_permissions pp ON pp.project_id = p.id
      WHERE pp.user_id = $1
      ORDER BY p.created_at`,
    [req.user.id]
  );
  res.json(rows);
});

// התמונה השמורה מוגשת בנפרד מהרשימה, ורק למי שרשאי לראות את הפרויקט.
router.get("/:id/image", async (req, res) => {
  const level = await permissionFor(req.user, req.params.id);
  if (!level) return res.status(404).json({ error: "פרויקט לא נמצא" });

  const row = await one("SELECT image FROM projects WHERE id = $1", [req.params.id]);
  const parsed = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(row?.image ?? "");
  if (!parsed) return res.status(404).json({ error: "אין תמונה לפרויקט" });

  res.set("Content-Type", parsed[1]);
  res.set("Cache-Control", "private, max-age=300");
  res.send(Buffer.from(parsed[2], "base64"));
});

router.post("/", requireAdmin, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "נדרש שם פרויקט" });

  const { id } = await one(
    `INSERT INTO projects (id, name, description, status, progress, created_by)
     VALUES ($1, $2, '', 'active', 0, $3)
     RETURNING id`,
    [uid(), name, req.user.id]
  );

  res.status(201).json({ ...(await fetchProject(id)), level: "admin" });
});

router.patch("/:id", async (req, res) => {
  const level = await permissionFor(req.user, req.params.id);
  if (!level) return res.status(404).json({ error: "פרויקט לא נמצא" });
  if (!canEdit(level)) return res.status(403).json({ error: "אין הרשאת עריכה" });

  const patch = req.body ?? {};
  const fields = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    fields.push(`${sql} = $${values.length}`);
  };

  if ("name" in patch) {
    // שינוי שם הוא פעולת מנהל, גם עבור איש צוות עם הרשאת עריכה.
    if (level !== "admin") return res.status(403).json({ error: "רק מנהל יכול לשנות שם פרויקט" });
    const name = typeof patch.name === "string" ? patch.name.trim() : "";
    if (!name) return res.status(400).json({ error: "נדרש שם פרויקט" });
    add("name", name);
  }
  if ("description" in patch) {
    if (typeof patch.description !== "string") return res.status(400).json({ error: "תיאור לא תקין" });
    add("description", patch.description);
  }
  if ("status" in patch) {
    if (!STATUSES.includes(patch.status)) return res.status(400).json({ error: "סטטוס לא תקין" });
    add("status", patch.status);
  }
  if ("progress" in patch) {
    const progress = Number(patch.progress);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      return res.status(400).json({ error: "התקדמות חייבת להיות מספר שלם בין 0 ל-100" });
    }
    add("progress", progress);
  }
  if ("link" in patch) {
    const link = normalizeLink(patch.link);
    if (link === null) return res.status(400).json({ error: "הקישור אינו כתובת תקינה" });
    add("link", link);
  }
  if ("audience" in patch) {
    if (typeof patch.audience !== "string") return res.status(400).json({ error: "קהל יעד לא תקין" });
    if (patch.audience.length > MAX_AUDIENCE_CHARS) {
      return res.status(400).json({ error: "אפיון קהל היעד ארוך מדי" });
    }
    add("audience", patch.audience);
  }
  if ("image" in patch) {
    const image = normalizeImage(patch.image);
    if (image === null) {
      return res.status(400).json({ error: "התמונה גדולה מדי או אינה בפורמט נתמך" });
    }
    add("image", image);
  }

  if (!fields.length) return res.status(400).json({ error: "אין שדות לעדכון" });

  values.push(req.params.id);
  await query(
    `UPDATE projects SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
    values
  );

  res.json({ ...(await fetchProject(req.params.id)), level });
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const result = await query("DELETE FROM projects WHERE id = $1", [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: "פרויקט לא נמצא" });
  res.json({ ok: true });
});

export default router;
