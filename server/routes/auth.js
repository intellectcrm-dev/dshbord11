import { Router } from "express";
import { db } from "../db.js";
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

// Deliberately identical for every failure mode, so the response never reveals
// whether a name exists.
const BAD_CREDENTIALS = { error: "סיסמה שגויה" };

function lockedResponse(res, retryInSec) {
  return res.status(429).json({
    error: `יותר מדי ניסיונות כניסה. נסה שוב בעוד ${Math.ceil(retryInSec / 60)} דקות.`,
  });
}

// The login screen needs names to choose from. Only id + name are exposed,
// and only for members — never password hashes or the admin account.
router.get("/members", (req, res) => {
  const members = db
    .prepare("SELECT id, name FROM users WHERE role = 'member' ORDER BY name")
    .all();
  res.json(members);
});

router.post("/admin-login", (req, res) => {
  const { password } = req.body ?? {};
  const key = `admin:${req.ip}`;
  const guard = loginGuard(key);
  if (guard.blocked) return lockedResponse(res, guard.retryInSec);

  if (typeof password !== "string" || !password) {
    registerFailure(key);
    return res.status(401).json(BAD_CREDENTIALS);
  }

  const admins = db.prepare("SELECT * FROM users WHERE role = 'admin'").all();
  const match = admins.find((a) => verifyPassword(password, a.password_hash));
  if (!match) {
    registerFailure(key);
    return res.status(401).json(BAD_CREDENTIALS);
  }

  clearFailures(key);
  issueSession(res, match);
  res.json({ user: { id: match.id, name: match.name, role: match.role } });
});

router.post("/member-login", (req, res) => {
  const { userId, password } = req.body ?? {};
  const key = `member:${req.ip}:${userId ?? ""}`;
  const guard = loginGuard(key);
  if (guard.blocked) return lockedResponse(res, guard.retryInSec);

  const user =
    typeof userId === "string"
      ? db.prepare("SELECT * FROM users WHERE id = ? AND role = 'member'").get(userId)
      : null;

  if (!user || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
    registerFailure(key);
    return res.status(401).json(BAD_CREDENTIALS);
  }

  clearFailures(key);
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
