import { Router } from "express";
import { all, one, query, uid } from "../db.js";
import { canEdit } from "../auth.js";

// הראוטר מורכב מתחת ל-/api/projects/:id, ולכן הוא צריך את הפרמטר של האב.
// ‎req.projectLevel נקבע במידלוור המשותף ב-projects.js.
const router = Router({ mergeParams: true });

const SEVERITIES = ["info", "warning", "critical"];
const MAX_TITLE = 300;
const MAX_BODY = 4000;

router.get("/", async (req, res) => {
  const [groups, notes] = await Promise.all([
    all(
      `SELECT id, title, note, position FROM project_note_groups
        WHERE project_id = $1 ORDER BY position, created_at`,
      [req.params.id]
    ),
    all(
      `SELECT id, group_id, source, title, body, url, severity, done, position, created_at
         FROM project_notes
        WHERE project_id = $1
        ORDER BY position, created_at DESC`,
      [req.params.id]
    ),
  ]);

  res.json({ groups, notes });
});

// פתיחת רשימה ריקה ביד. ה-AI בונה רשימה מלאה, אבל אפשר גם להתחיל אחת
// לבד ולמלא אותה — שני המסלולים מגיעים לאותו מבנה.
router.post("/groups", async (req, res) => {
  if (!canEdit(req.projectLevel)) return res.status(403).json({ error: "אין הרשאת עריכה" });

  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const note = typeof req.body?.note === "string" ? req.body.note : "";
  if (!title) return res.status(400).json({ error: "נדרשת כותרת לרשימה" });
  if (title.length > 200) return res.status(400).json({ error: "כותרת הרשימה ארוכה מדי" });
  if (note.length > 1000) return res.status(400).json({ error: "הסבר הרשימה ארוך מדי" });

  const { max } = await one(
    "SELECT coalesce(max(position), -1) AS max FROM project_note_groups WHERE project_id = $1",
    [req.params.id]
  );

  const group = await one(
    `INSERT INTO project_note_groups (id, project_id, title, note, position)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, note, position`,
    [uid(), req.params.id, title, note, Number(max) + 1]
  );

  res.status(201).json(group);
});

// מחיקת רשימה שלמה. הפריטים תלויים בקבוצה ונמחקים איתה.
router.delete("/groups/:groupId", async (req, res) => {
  if (!canEdit(req.projectLevel)) return res.status(403).json({ error: "אין הרשאת עריכה" });

  const result = await query(
    "DELETE FROM project_note_groups WHERE id = $1 AND project_id = $2",
    [req.params.groupId, req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "רשימה לא נמצאה" });

  res.json({ ok: true });
});

router.post("/", async (req, res) => {
  if (!canEdit(req.projectLevel)) return res.status(403).json({ error: "אין הרשאת עריכה" });

  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  const severity = typeof req.body?.severity === "string" ? req.body.severity : "info";

  if (!title) return res.status(400).json({ error: "נדרשת כותרת להערה" });
  if (title.length > MAX_TITLE) return res.status(400).json({ error: "הכותרת ארוכה מדי" });
  if (body.length > MAX_BODY) return res.status(400).json({ error: "גוף ההערה ארוך מדי" });
  if (!SEVERITIES.includes(severity)) return res.status(400).json({ error: "חומרה לא חוקית" });

  // שיוך לקבוצה מאומת מול אותו פרויקט, כדי שלא ניתן יהיה לתלות פריט
  // ברשימה של פרויקט אחר.
  const groupId = typeof req.body?.groupId === "string" && req.body.groupId ? req.body.groupId : null;
  if (groupId) {
    const group = await one(
      "SELECT id FROM project_note_groups WHERE id = $1 AND project_id = $2",
      [groupId, req.params.id]
    );
    if (!group) return res.status(400).json({ error: "רשימה לא נמצאה" });
  }

  const note = await one(
    `INSERT INTO project_notes (id, project_id, group_id, source, title, body, severity)
     VALUES ($1, $2, $3, 'manual', $4, $5, $6)
     RETURNING id, group_id, source, title, body, url, severity, done, position, created_at`,
    [uid(), req.params.id, groupId, title, body, severity]
  );

  res.status(201).json(note);
});

router.patch("/:noteId", async (req, res) => {
  if (!canEdit(req.projectLevel)) return res.status(403).json({ error: "אין הרשאת עריכה" });

  const fields = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    fields.push(`${sql} = $${values.length}`);
  };

  if ("done" in req.body) {
    if (typeof req.body.done !== "boolean") return res.status(400).json({ error: "ערך לא תקין" });
    add("done", req.body.done);
  }
  if ("title" in req.body) {
    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    if (!title || title.length > MAX_TITLE) return res.status(400).json({ error: "כותרת לא תקינה" });
    add("title", title);
  }
  if ("severity" in req.body) {
    if (!SEVERITIES.includes(req.body.severity)) return res.status(400).json({ error: "חומרה לא חוקית" });
    add("severity", req.body.severity);
  }
  if (!fields.length) return res.status(400).json({ error: "אין שדות לעדכון" });

  values.push(req.params.noteId, req.params.id);
  const note = await one(
    `UPDATE project_notes SET ${fields.join(", ")}
      WHERE id = $${values.length - 1} AND project_id = $${values.length}
      RETURNING id, group_id, source, title, body, url, severity, done, position, created_at`,
    values
  );
  if (!note) return res.status(404).json({ error: "הערה לא נמצאה" });

  res.json(note);
});

router.delete("/:noteId", async (req, res) => {
  if (!canEdit(req.projectLevel)) return res.status(403).json({ error: "אין הרשאת עריכה" });

  const result = await query("DELETE FROM project_notes WHERE id = $1 AND project_id = $2", [
    req.params.noteId,
    req.params.id,
  ]);
  if (!result.rowCount) return res.status(404).json({ error: "הערה לא נמצאה" });

  res.json({ ok: true });
});

export default router;
