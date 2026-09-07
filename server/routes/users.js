import { Router } from "express";
import { db, uid } from "../db.js";
import { requireAuth, requireAdmin, hashPassword } from "../auth.js";

const router = Router();

router.use(requireAuth, requireAdmin);

// Members with their permission map: { [projectId]: 'view' | 'edit' }.
router.get("/", (req, res) => {
  const users = db
    .prepare("SELECT id, name, role, created_at FROM users WHERE role = 'member' ORDER BY created_at")
    .all();
  const perms = db.prepare("SELECT user_id, project_id, level FROM project_permissions").all();

  res.json(
    users.map((u) => ({
      ...u,
      permissions: Object.fromEntries(
        perms.filter((p) => p.user_id === u.id).map((p) => [p.project_id, p.level])
      ),
    }))
  );
});

router.post("/", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!name) return res.status(400).json({ error: "נדרש שם" });
  if (password.length < 6) return res.status(400).json({ error: "הסיסמה חייבת להכיל לפחות 6 תווים" });

  const id = uid();
  db.prepare("INSERT INTO users (id, name, password_hash, role) VALUES (?, ?, ?, 'member')").run(
    id,
    name,
    hashPassword(password)
  );

  res.status(201).json({ id, name, role: "member", permissions: {} });
});

router.delete("/:id", (req, res) => {
  const target = db.prepare("SELECT role FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "משתמש לא נמצא" });
  if (target.role === "admin") return res.status(403).json({ error: "לא ניתן למחוק חשבון מנהל" });

  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
