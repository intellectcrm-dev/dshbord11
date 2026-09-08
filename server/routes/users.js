import { Router } from "express";
import { all, one, query, uid } from "../db.js";
import { requireAuth, requireAdmin, hashPassword, TEAM_ROLES } from "../auth.js";

const router = Router();

router.use(requireAuth, requireAdmin);

// אנשי צוות עם מפת ההרשאות שלהם: { [projectId]: 'view' | 'edit' }.
router.get("/", async (req, res) => {
  const [users, perms] = await Promise.all([
    all(
      `SELECT id, name, role, created_at FROM users
        WHERE role <> 'admin' ORDER BY created_at`
    ),
    all("SELECT user_id, project_id, level FROM project_permissions"),
  ]);

  res.json(
    users.map((u) => ({
      ...u,
      permissions: Object.fromEntries(
        perms.filter((p) => p.user_id === u.id).map((p) => [p.project_id, p.level])
      ),
    }))
  );
});

router.post("/", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  const role = typeof req.body?.role === "string" ? req.body.role : "member";

  if (!name) return res.status(400).json({ error: "נדרש שם" });
  if (password.length < 6) return res.status(400).json({ error: "הסיסמה חייבת להכיל לפחות 6 תווים" });
  if (!TEAM_ROLES.includes(role)) return res.status(400).json({ error: "תפקיד לא חוקי" });

  const id = uid();
  await query("INSERT INTO users (id, name, password_hash, role) VALUES ($1, $2, $3, $4)", [
    id,
    name,
    hashPassword(password),
    role,
  ]);

  res.status(201).json({ id, name, role, permissions: {} });
});

router.delete("/:id", async (req, res) => {
  const target = await one("SELECT role FROM users WHERE id = $1", [req.params.id]);
  if (!target) return res.status(404).json({ error: "משתמש לא נמצא" });
  if (target.role === "admin") return res.status(403).json({ error: "לא ניתן למחוק חשבון מנהל" });

  await query("DELETE FROM users WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
