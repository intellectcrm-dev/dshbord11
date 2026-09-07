import { Router } from "express";
import { db, uid } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";

const router = Router();

router.use(requireAuth, requireAdmin);

// level: 'none' removes the row entirely — no row means no access at all.
router.put("/", (req, res) => {
  const { userId, projectId, level } = req.body ?? {};

  if (!["none", "view", "edit"].includes(level)) {
    return res.status(400).json({ error: "רמת הרשאה לא תקינה" });
  }

  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (!user || user.role !== "member") return res.status(404).json({ error: "משתמש לא נמצא" });

  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) return res.status(404).json({ error: "פרויקט לא נמצא" });

  if (level === "none") {
    db.prepare("DELETE FROM project_permissions WHERE user_id = ? AND project_id = ?").run(
      userId,
      projectId
    );
  } else {
    db.prepare(
      `INSERT INTO project_permissions (id, user_id, project_id, level)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, project_id) DO UPDATE SET level = excluded.level`
    ).run(uid(), userId, projectId, level);
  }

  res.json({ userId, projectId, level });
});

export default router;
