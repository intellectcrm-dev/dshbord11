// יצירת הסכימה וחשבון המנהל הראשון מול DATABASE_URL. אפשר להריץ שוב ושוב:
// הפעולה אידמפוטנטית ולא נוגעת בנתונים קיימים.
import "dotenv/config";
import { closePool, ensureReady, SCHEMA } from "../server/db.js";

try {
  await ensureReady();
  console.log(`בסיס הנתונים מוכן (סכימה: ${SCHEMA})`);
} catch (err) {
  console.error("יצירת בסיס הנתונים נכשלה:", err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
