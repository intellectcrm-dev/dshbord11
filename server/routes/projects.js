import { Router } from "express";
import { db, uid } from "../db.js";
import { requireAuth, requireAdmin, permissionFor, canEdit } from "../auth.js";

const router = Router();
const STATUSES = ["active", "paused", "done", "blocked"];

router.use(requireAuth);

router.get("/", (req, res) => {
  if (req.user.role === "admin") {
    const rows = db.prepare("SELECT * FROM projects ORDER BY created_at").all();
    return res.json(rows.map((p) => ({ ...p, level: "admin" })));
  }
  const rows = db
    .prepare(
      `SELECT p.*, pp.level
         FROM projects p
         JOIN project_permissions pp ON pp.project_id = p.id
        WHERE pp.user_id = ?
        ORDER BY p.created_at`
    )
    .all(req.user.id);
  res.json(rows);
});

router.post("/", requireAdmin, (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "נדרש שם פרויקט" });

  const id = uid();
  db.prepare(
    `INSERT INTO projects (id, name, description, status, progress, created_by)
     VALUES (?, ?, '', 'active', 0, ?)`
  ).run(id, name, req.user.id);

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  res.status(201).json({ ...project, level: "admin" });
});

router.patch("/:id", (req, res) => {
  const level = permissionFor(req.user, req.params.id);
  if (!level) return res.status(404).json({ error: "פרויקט לא נמצא" });
  if (!canEdit(level)) return res.status(403).json({ error: "אין הרשאת עריכה" });

  const patch = req.body ?? {};
  const fields = [];
  const values = [];

  if ("name" in patch) {
    // Renaming a project is an admin action even for members with edit rights.
    if (level !== "admin") return res.status(403).json({ error: "רק מנהל יכול לשנות שם פרויקט" });
    const name = typeof patch.name === "string" ? patch.name.trim() : "";
    if (!name) return res.status(400).json({ error: "נדרש שם פרויקט" });
    fields.push("name = ?");
    values.push(name);
  }
  if ("description" in patch) {
    if (typeof patch.description !== "string") return res.status(400).json({ error: "תיאור לא תקין" });
    fields.push("description = ?");
    values.push(patch.description);
  }
  if ("status" in patch) {
    if (!STATUSES.includes(patch.status)) return res.status(400).json({ error: "סטטוס לא תקין" });
    fields.push("status = ?");
    values.push(patch.status);
  }
  if ("progress" in patch) {
    const progress = Number(patch.progress);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      return res.status(400).json({ error: "התקדמות חייבת להיות מספר שלם בין 0 ל-100" });
    }
    fields.push("progress = ?");
    values.push(progress);
  }

  if (!fields.length) return res.status(400).json({ error: "אין שדות לעדכון" });

  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values, req.params.id);

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  res.json({ ...project, level });
});

router.delete("/:id", requireAdmin, (req, res) => {
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "פרויקט לא נמצא" });
  res.json({ ok: true });
});

export default router;
