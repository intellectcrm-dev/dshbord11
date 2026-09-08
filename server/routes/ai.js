import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { one } from "../db.js";
import { requireAuth, permissionFor, canEdit } from "../auth.js";

const router = Router();

// הסכימה נאכפת על ידי ה-API עצמו, ולכן התשובה חוזרת כאובייקט ולא כטקסט
// שצריך לנחש איך לפרסר.
const CopySchema = z.object({
  description: z.string(),
  audience: z.string(),
});

const SYSTEM = `אתה עוזר לבעל עסק לנהל לוח פרויקטים. בהינתן שם של פרויקט, כתוב שני שדות בעברית:

description — תיאור קצר של הפרויקט, משפט או שניים, עד 220 תווים. ענייני, בלשון פשוטה, בלי סופרלטיבים ובלי שיווקיות.
audience — אפיון קהל היעד: מי הם, טווח גילים אם רלוונטי, ומה מניע אותם לפעולה. עד 180 תווים.

אם שם הפרויקט לא מספיק כדי לדעת במה מדובר, כתוב את ההנחה הסבירה ביותר בניסוח כללי — אל תמציא פרטים ספציפיים כמו שמות לקוחות, מספרים או תאריכים.`;

let client;

// הלקוח נבנה בשימוש הראשון: בלי מפתח אין מה לבנות, והשרת חייב לעלות גם אז.
function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return (client ??= new Anthropic({ apiKey }));
}

router.use(requireAuth);

router.post("/project-copy", async (req, res) => {
  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
  const level = await permissionFor(req.user, projectId);
  if (!level) return res.status(404).json({ error: "פרויקט לא נמצא" });
  if (!canEdit(level)) return res.status(403).json({ error: "אין הרשאת עריכה" });

  // מנהל מקבל הרשאה לכל מזהה, גם לכזה שאינו קיים, ולכן הפרויקט נטען לפני
  // בדיקת המפתח — אחרת בקשה לפרויקט שנמחק הייתה נענית "אין מפתח".
  const project = await one("SELECT name FROM projects WHERE id = $1", [projectId]);
  if (!project) return res.status(404).json({ error: "פרויקט לא נמצא" });

  const anthropic = getClient();
  if (!anthropic) {
    return res.status(503).json({
      error:
        "הכתיבה האוטומטית עדיין לא הופעלה. צריך להגדיר ANTHROPIC_API_KEY במשתני הסביבה ולהריץ פריסה מחדש.",
    });
  }

  try {
    const message = await anthropic.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { format: zodOutputFormat(CopySchema) },
      messages: [{ role: "user", content: `שם הפרויקט: ${project.name}` }],
    });

    if (message.stop_reason === "refusal") {
      return res.status(422).json({ error: "המודל לא יכול לכתוב עבור הפרויקט הזה. נסח את השם אחרת." });
    }
    if (!message.parsed_output) {
      return res.status(502).json({ error: "התשובה חזרה בפורמט לא צפוי. נסה שוב." });
    }

    res.json(message.parsed_output);
  } catch (err) {
    // שרשרת מהספציפי לכללי: תקלת מפתח או מכסה דורשת טיפול אחר מתקלת רשת.
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(502).json({ error: "מפתח ה-API שהוגדר אינו תקף." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "יותר מדי בקשות לכתיבה אוטומטית. נסה שוב בעוד רגע." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("כתיבה אוטומטית נכשלה:", err.status, err.message);
      return res.status(502).json({ error: "שירות הכתיבה האוטומטית לא זמין כרגע." });
    }
    throw err;
  }
});

export default router;
