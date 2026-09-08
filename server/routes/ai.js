import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { one, query, uid } from "../db.js";
import { requireAuth, permissionFor, canEdit } from "../auth.js";
import { GitHubError, fetchRepoSnapshot, parseRepo } from "./github.js";

const router = Router();

const MODEL = "claude-opus-5";

// הסכימות נאכפות על ידי ה-API עצמו, ולכן התשובה חוזרת כאובייקט ולא כטקסט
// שצריך לנחש איך לפרסר.
const CopySchema = z.object({
  description: z.string(),
  audience: z.string(),
});

const FindingsSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
      severity: z.enum(["info", "warning", "critical"]),
    })
  ),
});

const BriefSchema = z.object({
  brief: z.string(),
});

const COPY_SYSTEM = `אתה עוזר לבעל עסק לנהל לוח פרויקטים. בהינתן שם של פרויקט, כתוב שני שדות בעברית:

description — תיאור קצר של הפרויקט, משפט או שניים, עד 220 תווים. ענייני, בלשון פשוטה, בלי סופרלטיבים ובלי שיווקיות.
audience — אפיון קהל היעד: מי הם, טווח גילים אם רלוונטי, ומה מניע אותם לפעולה. עד 180 תווים.

אם שם הפרויקט לא מספיק כדי לדעת במה מדובר, כתוב את ההנחה הסבירה ביותר בניסוח כללי — אל תמציא פרטים ספציפיים כמו שמות לקוחות, מספרים או תאריכים.`;

const SCAN_SYSTEM = `אתה סוקר קוד עבור מנהל שצריך להחליט אם מערכת מוכנה למסירה. אתה מקבל חלק מקובצי הריפו — לא את כולו.

כתוב בעברית. החזר:

summary — שתיים-שלוש שורות: האם המערכת נראית מוכנה, ומה החסם המרכזי אם יש.
findings — רשימת ממצאים לתיקון. לכל ממצא:
  title — מה הבעיה, שורה אחת קצרה, עם שם הקובץ אם הוא ידוע.
  body — למה זה בעיה ומה לתקן, עד 400 תווים.
  severity — critical לבאג שישבור משתמשים או לחור אבטחה, warning לבעיה אמיתית שאינה חוסמת, info לשיפור.

כללים:
- דווח רק על מה שאתה רואה בקוד שקיבלת. אל תשער לגבי קבצים שלא הוצגו לך.
- אל תמציא ממצאים כדי למלא רשימה. אם הקוד נראה תקין, החזר findings ריק ואמור זאת ב-summary.
- עד 12 ממצאים, החמורים ראשונים.`;

const BRIEF_SYSTEM = `אתה כותב תדריך קצר לאיש שיווק שמקבל מערכת חדשה לקדם. אתה מקבל את פרטי הפרויקט.

כתוב בעברית שדה אחד, brief, בין 120 ל-900 תווים, במבנה הזה בדיוק:

מה המערכת עושה — משפט או שניים.
קהל היעד — מי הם ומה כואב להם.
מה להדגיש — שתיים-שלוש נקודות מכירה שנובעות ממה שנמסר לך.

אל תמציא מחירים, נתוני ביצועים, שמות לקוחות או הבטחות. אם פרט חסר, דלג עליו במקום להשלים אותו.`;

let client;

// הלקוח נבנה בשימוש הראשון: בלי מפתח אין מה לבנות, והשרת חייב לעלות גם אז.
function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return (client ??= new Anthropic({ apiKey }));
}

const NO_KEY = {
  error:
    "הכתיבה האוטומטית עדיין לא הופעלה. צריך להגדיר ANTHROPIC_API_KEY במשתני הסביבה ולהריץ פריסה מחדש.",
};

// כל נתיבי ה-AI פועלים על פרויקט קיים שמותר למשתמש לערוך.
async function loadProject(req, res) {
  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
  const level = await permissionFor(req.user, projectId);
  if (!level) {
    res.status(404).json({ error: "פרויקט לא נמצא" });
    return null;
  }
  if (!canEdit(level)) {
    res.status(403).json({ error: "אין הרשאת עריכה" });
    return null;
  }

  // מנהל מקבל הרשאה לכל מזהה, גם לכזה שאינו קיים, ולכן הפרויקט נטען בפועל.
  const project = await one(
    "SELECT id, name, description, audience, repo_url FROM projects WHERE id = $1",
    [projectId]
  );
  if (!project) {
    res.status(404).json({ error: "פרויקט לא נמצא" });
    return null;
  }
  return project;
}

// שרשרת מהספציפי לכללי: תקלת מפתח או מכסה דורשת טיפול אחר מתקלת רשת.
function fail(res, err) {
  if (err instanceof GitHubError) return res.status(err.status).json({ error: err.message });
  if (err instanceof Anthropic.AuthenticationError) {
    return res.status(502).json({ error: "מפתח ה-API שהוגדר אינו תקף." });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return res.status(429).json({ error: "יותר מדי בקשות. נסה שוב בעוד רגע." });
  }
  if (err instanceof Anthropic.APIError) {
    console.error("קריאה למודל נכשלה:", err.status, err.message);
    return res.status(502).json({ error: "שירות הכתיבה האוטומטית לא זמין כרגע." });
  }
  throw err;
}

function guard(res, message) {
  if (message.stop_reason === "refusal") {
    res.status(422).json({ error: "המודל לא יכול לענות על הבקשה הזו." });
    return false;
  }
  if (!message.parsed_output) {
    res.status(502).json({ error: "התשובה חזרה בפורמט לא צפוי. נסה שוב." });
    return false;
  }
  return true;
}

router.use(requireAuth);

router.post("/project-copy", async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return;

  const anthropic = getClient();
  if (!anthropic) return res.status(503).json(NO_KEY);

  try {
    const message = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: COPY_SYSTEM,
      output_config: { format: zodOutputFormat(CopySchema) },
      messages: [{ role: "user", content: `שם הפרויקט: ${project.name}` }],
    });
    if (!guard(res, message)) return;
    res.json(message.parsed_output);
  } catch (err) {
    fail(res, err);
  }
});

// סריקת הקוד. הממצאים נשמרים כהערות, כך שהם מתערבבים עם ה-issues מ-GitHub
// ועם מה שנכתב ביד — שלוש הרשימות שהמנהל צריך לעבור עליהן הן אחת.
router.post("/scan", async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return;

  const repo = parseRepo(project.repo_url);
  if (!repo) return res.status(400).json({ error: "לפרויקט אין קישור תקין ל-GitHub." });

  const anthropic = getClient();
  if (!anthropic) return res.status(503).json(NO_KEY);

  try {
    const snapshot = await fetchRepoSnapshot(repo);
    if (!snapshot.files.length) {
      return res.status(422).json({ error: "לא נמצאו קובצי מקור לסריקה בריפו הזה." });
    }

    const sources = snapshot.files
      .map((f) => `--- ${f.path} ---\n${f.text}`)
      .join("\n\n");

    const message = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SCAN_SYSTEM,
      output_config: { format: zodOutputFormat(FindingsSchema) },
      messages: [
        {
          role: "user",
          content: `פרויקט: ${project.name}\nריפו: ${repo.owner}/${repo.repo}\nקבצים שנסרקו: ${snapshot.files.length}\n\n${sources}`,
        },
      ],
    });
    if (!guard(res, message)) return;

    const { summary, findings } = message.parsed_output;

    // ממצאים פתוחים מסריקה קודמת מוחלפים. מה שכבר סומן כטופל נשאר, כדי
    // שסריקה חוזרת לא תמחק את ההיסטוריה של מה שתוקן.
    await query("DELETE FROM project_notes WHERE project_id = $1 AND source = 'ai' AND NOT done", [
      project.id,
    ]);

    for (const finding of findings.slice(0, 12)) {
      await query(
        `INSERT INTO project_notes (id, project_id, source, title, body, severity)
         VALUES ($1, $2, 'ai', $3, $4, $5)`,
        [uid(), project.id, finding.title.slice(0, 300), finding.body.slice(0, 4000), finding.severity]
      );
    }

    res.json({ summary, added: findings.length, scanned: snapshot.files.length });
  } catch (err) {
    fail(res, err);
  }
});

// התדריך שנוסע עם הפרויקט כשהוא מועבר לשיווק.
router.post("/brief", async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return;

  const anthropic = getClient();
  if (!anthropic) return res.status(503).json(NO_KEY);

  try {
    const message = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: BRIEF_SYSTEM,
      output_config: { format: zodOutputFormat(BriefSchema) },
      messages: [
        {
          role: "user",
          content: [
            `שם המערכת: ${project.name}`,
            `תיאור: ${project.description || "לא נכתב"}`,
            `קהל יעד: ${project.audience || "לא נכתב"}`,
          ].join("\n"),
        },
      ],
    });
    if (!guard(res, message)) return;

    await query("UPDATE projects SET brief = $1, updated_at = now() WHERE id = $2", [
      message.parsed_output.brief,
      project.id,
    ]);

    res.json(message.parsed_output);
  } catch (err) {
    fail(res, err);
  }
});

export default router;
