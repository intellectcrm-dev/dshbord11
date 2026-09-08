import { Router } from "express";
import { one, query, uid } from "../db.js";
import { canEdit } from "../auth.js";

const router = Router({ mergeParams: true });

const API = "https://api.github.com";
const MAX_ISSUES = 50;

export function parseRepo(url) {
  const match = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
    url ?? ""
  );
  return match ? { owner: match[1], repo: match[2] } : null;
}

export function githubToken() {
  return process.env.GITHUB_TOKEN?.trim() || "";
}

// שגיאה עם status כדי שהראוט יוכל לתרגם אותה לתשובה מדויקת ללא try מקונן.
export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function gh(path) {
  const token = githubToken();
  if (!token) throw new GitHubError(503, "חיבור ל-GitHub לא הוגדר. חסר GITHUB_TOKEN.");

  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      "User-Agent": "projects-dashboard",
    },
  });

  if (res.status === 401) throw new GitHubError(502, "האסימון של GitHub אינו תקף.");
  if (res.status === 403) throw new GitHubError(502, "GitHub סירב לבקשה. בדוק את ההרשאות של האסימון.");
  if (res.status === 404) throw new GitHubError(404, "הריפו לא נמצא, או שאין לאסימון גישה אליו.");
  if (!res.ok) throw new GitHubError(502, `GitHub החזיר שגיאה ${res.status}.`);

  return res.json();
}

// issue עם תווית bug או security חשוב יותר מבקשת פיצ'ר, וזה מה שקובע את
// הסדר שבו ההערות מוצגות.
function severityOf(labels) {
  const names = (labels ?? []).map((l) => String(l?.name ?? "").toLowerCase());
  if (names.some((n) => n.includes("critical") || n.includes("security"))) return "critical";
  if (names.some((n) => n.includes("bug") || n.includes("regression"))) return "warning";
  return "info";
}

async function loadRepo(req, res) {
  const project = await one("SELECT id, repo_url FROM projects WHERE id = $1", [req.params.id]);
  if (!project) {
    res.status(404).json({ error: "פרויקט לא נמצא" });
    return null;
  }
  const repo = parseRepo(project.repo_url);
  if (!repo) {
    res.status(400).json({ error: "לפרויקט אין קישור תקין ל-GitHub." });
    return null;
  }
  return repo;
}

function fail(res, err) {
  if (err instanceof GitHubError) return res.status(err.status).json({ error: err.message });
  throw err;
}

// מצב הריפו במבט אחד: מתי נגעו בו לאחרונה, כמה issues פתוחים, והאם
// ההרצה האחרונה של הבדיקות עברה.
router.get("/", async (req, res) => {
  const repo = await loadRepo(req, res);
  if (!repo) return;

  try {
    const [info, commits, runs] = await Promise.all([
      gh(`/repos/${repo.owner}/${repo.repo}`),
      gh(`/repos/${repo.owner}/${repo.repo}/commits?per_page=1`),
      gh(`/repos/${repo.owner}/${repo.repo}/actions/runs?per_page=1`).catch(() => ({
        workflow_runs: [],
      })),
    ]);

    const commit = commits?.[0];
    const run = runs?.workflow_runs?.[0];

    res.json({
      full_name: info.full_name,
      default_branch: info.default_branch,
      pushed_at: info.pushed_at,
      open_issues: info.open_issues_count,
      last_commit: commit
        ? {
            message: commit.commit?.message?.split("\n")[0] ?? "",
            author: commit.commit?.author?.name ?? "",
            date: commit.commit?.author?.date ?? "",
            url: commit.html_url,
          }
        : null,
      checks: run ? { status: run.status, conclusion: run.conclusion, url: run.html_url } : null,
    });
  } catch (err) {
    fail(res, err);
  }
});

// משיכת ה-issues הפתוחים לתוך רשימת ההערות. ריצה חוזרת מעדכנת את מה
// שכבר נמשך במקום לשכפל אותו, בזכות המפתח הייחודי על external_id.
router.post("/sync", async (req, res) => {
  if (!canEdit(req.projectLevel)) return res.status(403).json({ error: "אין הרשאת עריכה" });

  const repo = await loadRepo(req, res);
  if (!repo) return;

  try {
    const issues = await gh(
      `/repos/${repo.owner}/${repo.repo}/issues?state=open&per_page=${MAX_ISSUES}`
    );

    // ‎GitHub מחזיר גם pull requests תחת issues. אלה לא הערות לתיקון.
    const real = issues.filter((issue) => !issue.pull_request);

    for (const issue of real) {
      await query(
        `INSERT INTO project_notes
           (id, project_id, source, title, body, url, severity, external_id)
         VALUES ($1, $2, 'github', $3, $4, $5, $6, $7)
         ON CONFLICT (project_id, source, external_id) WHERE external_id <> ''
         DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body,
                       url = EXCLUDED.url, severity = EXCLUDED.severity`,
        [
          uid(),
          req.params.id,
          `#${issue.number} ${issue.title}`,
          (issue.body ?? "").slice(0, 4000),
          issue.html_url,
          severityOf(issue.labels),
          String(issue.number),
        ]
      );
    }

    res.json({ imported: real.length });
  } catch (err) {
    fail(res, err);
  }
});

// צילום מצב של הקוד עבור הסריקה. הגבולות כאן אינם קישוט: קריאה אחת
// למודל על ריפו שלם היא איטית ויקרה, ופונקציית serverless נחתכת בזמן.
const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|java|php|cs|sql|json|md|yml|yaml)$/i;
const SKIP_PATH = /(^|\/)(node_modules|dist|build|vendor|\.next|coverage)(\/|$)|lock\.json$|\.lock$/i;

// README ותצורה מסבירים את הפרויקט, ולכן הם נקראים לפני קובצי מקור.
function priority(path) {
  if (/^readme/i.test(path)) return 0;
  if (/^(package\.json|requirements\.txt|go\.mod|composer\.json)$/i.test(path)) return 1;
  if (/\.md$/i.test(path)) return 3;
  return 2;
}

export async function fetchRepoSnapshot({ owner, repo }, { maxFiles = 18, maxBytes = 120_000 } = {}) {
  const info = await gh(`/repos/${owner}/${repo}`);
  const tree = await gh(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(info.default_branch)}?recursive=1`
  );

  const candidates = (tree.tree ?? [])
    .filter((n) => n.type === "blob" && n.size > 0 && n.size < 60_000)
    .filter((n) => SOURCE_EXT.test(n.path) && !SKIP_PATH.test(n.path))
    .sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path))
    .slice(0, maxFiles);

  const files = [];
  let budget = maxBytes;
  for (const node of candidates) {
    if (budget <= 0) break;
    try {
      const blob = await gh(`/repos/${owner}/${repo}/git/blobs/${node.sha}`);
      const text = Buffer.from(blob.content ?? "", "base64").toString("utf8").slice(0, budget);
      budget -= text.length;
      files.push({ path: node.path, text });
    } catch {
      // קובץ בודד שלא נקרא לא אמור להפיל סריקה שלמה.
    }
  }

  return { default_branch: info.default_branch, truncated: candidates.length < (tree.tree ?? []).length, files };
}

export default router;
