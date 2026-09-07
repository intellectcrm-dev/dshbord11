import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireAdmin, hashPassword, issueSession } from "../auth.js";

const router = Router();

router.use(requireAuth, requireAdmin);

router.put("/password", (req, res) => {
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "סיסמת מנהל חייבת להכיל לפחות 8 תווים" });
  }

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(newPassword),
    req.user.id
  );

  // The old token carries a fingerprint of the previous hash and is now dead;
  // hand the current browser a fresh one so the admin is not logged out.
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  issueSession(res, updated);

  res.json({ ok: true });
});

export default router;
