import { Router } from "express";
import { one, query, uid } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";

const router = Router();

router.use(requireAuth, requireAdmin);

// level 'none' מוחק את הרשומה לגמרי — היעדר רשומה הוא היעדר גישה.
router.put("/", async (req, res) => {
  const { userId, projectId, level } = req.body ?? {};

  if (!["none", "view", "edit"].includes(level)) {
    return res.status(400).json({ error: "רמת הרשאה לא תקינה" });
  }

  const user = await one("SELECT role FROM users WHERE id = $1", [userId]);
  if (!user || user.role !== "member") return res.status(404).json({ error: "משתמש לא נמצא" });

  const project = await one("SELECT id FROM projects WHERE id = $1", [projectId]);
  if (!project) return res.status(404).json({ error: "פרויקט לא נמצא" });

  if (level === "none") {
    await query("DELETE FROM project_permissions WHERE user_id = $1 AND project_id = $2", [
      userId,
      projectId,
    ]);
  } else {
    await query(
      `INSERT INTO project_permissions (id, user_id, project_id, level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, project_id) DO UPDATE SET level = EXCLUDED.level`,
      [uid(), userId, projectId, level]
    );
  }

  res.json({ userId, projectId, level });
});

export default router;
