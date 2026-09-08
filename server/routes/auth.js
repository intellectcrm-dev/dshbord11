import { Router } from "express";
import { all, one } from "../db.js";
import {
  verifyPassword,
  issueSession,
  clearSession,
  requireAuth,
  loginGuard,
  registerFailure,
  clearFailures,
} from "../auth.js";

const router = Router();

// זהה לכל סוגי הכישלון, כדי שהתשובה לא תסגיר אם השם קיים.
const BAD_CREDENTIALS = { error: "סיסמה שגויה" };

function lockedResponse(res, retryInSec) {
  return res.status(429).json({
    error: `יותר מדי ניסיונות כניסה. נסה שוב בעוד ${Math.ceil(retryInSec / 60)} דקות.`,
  });
}

// מסך הכניסה צריך רשימת שמות לבחירה. נחשפים id ושם בלבד, ורק לאנשי צוות —
// לא hash של סיסמה ולא חשבון המנהל.
router.get("/members", async (req, res) => {
  const members = await all("SELECT id, name FROM users WHERE role = 'member' ORDER BY name");
  res.json(members);
});

router.post("/admin-login", async (req, res) => {
  const { password } = req.body ?? {};
  const key = `admin:${req.ip}`;

  const guard = await loginGuard(key);
  if (guard.blocked) return lockedResponse(res, guard.retryInSec);

  if (typeof password !== "string" || !password) {
    await registerFailure(key);
    return res.status(401).json(BAD_CREDENTIALS);
  }

  const admins = await all("SELECT * FROM users WHERE role = 'admin'");
  const match = admins.find((a) => verifyPassword(password, a.password_hash));
  if (!match) {
    await registerFailure(key);
    return res.status(401).json(BAD_CREDENTIALS);
  }

  await clearFailures(key);
  issueSession(res, match);
  res.json({ user: { id: match.id, name: match.name, role: match.role } });
});

router.post("/member-login", async (req, res) => {
  const { userId, password } = req.body ?? {};
  const key = `member:${req.ip}:${userId ?? ""}`;

  const guard = await loginGuard(key);
  if (guard.blocked) return lockedResponse(res, guard.retryInSec);

  const user =
    typeof userId === "string"
      ? await one("SELECT * FROM users WHERE id = $1 AND role = 'member'", [userId])
      : null;

  if (!user || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
    await registerFailure(key);
    return res.status(401).json(BAD_CREDENTIALS);
  }

  await clearFailures(key);
  issueSession(res, user);
  res.json({ user: { id: user.id, name: user.name, role: user.role } });
});

router.post("/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, name: req.user.name, role: req.user.role } });
});

export default router;
