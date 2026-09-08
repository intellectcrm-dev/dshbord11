import { Router } from "express";
import { one } from "../db.js";
import { requireAuth, requireAdmin, hashPassword, issueSession } from "../auth.js";

const router = Router();

router.use(requireAuth, requireAdmin);

router.put("/password", async (req, res) => {
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "סיסמת מנהל חייבת להכיל לפחות 8 תווים" });
  }

  // הטוקן הישן נושא טביעת אצבע של ה-hash הקודם ומת ברגע זה, ולכן מנפיקים
  // לדפדפן הנוכחי טוקן חדש כדי שהמנהל עצמו לא יינתק.
  const updated = await one(
    "UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *",
    [hashPassword(newPassword), req.user.id]
  );
  issueSession(res, updated);

  res.json({ ok: true });
});

export default router;
