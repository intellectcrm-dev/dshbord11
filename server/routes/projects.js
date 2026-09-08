import { Router } from "express";
import { all, one, query, uid } from "../db.js";
import { requireAuth, requireAdmin, permissionFor, canEdit } from "../auth.js";

const router = Router();
const STATUSES = ["active", "paused", "done", "blocked"];

router.use(requireAuth);

router.get("/", async (req, res) => {
  if (req.user.role === "admin") {
    const rows = await all("SELECT * FROM projects ORDER BY created_at");
    return res.json(rows.map((p) => ({ ...p, level: "admin" })));
  }

  const rows = await all(
    `SELECT p.*, pp.level
       FROM projects p
       JOIN project_permissions pp ON pp.project_id = p.id
      WHERE pp.user_id = $1
      ORDER BY p.created_at`,
    [req.user.id]
  );
  res.json(rows);
});

router.post("/", requireAdmin, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "נדרש שם פרויקט" });

  const project = await one(
    `INSERT INTO projects (id, name, description, status, progress, created_by)
     VALUES ($1, $2, '', 'active', 0, $3)
     RETURNING *`,
    [uid(), name, req.user.id]
  );

  res.status(201).json({ ...project, level: "admin" });
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

  if (!fields.length) return res.status(400).json({ error: "אין שדות לעדכון" });

  values.push(req.params.id);
  const project = await one(
    `UPDATE projects SET ${fields.join(", ")}, updated_at = now()
      WHERE id = $${values.length}
      RETURNING *`,
    values
  );

  res.json({ ...project, level });
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const result = await query("DELETE FROM projects WHERE id = $1", [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: "פרויקט לא נמצא" });
  res.json({ ok: true });
});

export default router;
