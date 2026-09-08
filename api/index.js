// נקודת הכניסה של Vercel: אותה אפליקציית Express, עטופה כפונקציית serverless.
import app from "../server/index.js";

export default function handler(req, res) {
  // ה-rewrite של Vercel עשוי להעביר את הנתיב עם או בלי הקידומת /api,
  // תלוי בתצורה. מנרמלים כאן כדי שהראוטים של Express יראו תמיד /api/...
  if (!req.url.startsWith("/api")) {
    req.url = `/api${req.url === "/" ? "" : req.url}`;
  }
  return app(req, res);
}
