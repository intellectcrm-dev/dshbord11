// תשובה שלא הגיעה מהשרת שלנו (דף שגיאה של Vercel, גוף ריק, timeout) לא
// נושאת שדה error. במקום «שגיאה בלתי צפויה» אילמת מציגים את הסטטוס ומה
// שאפשר לחלץ, כדי שאפשר יהיה לאבחן את הפריסה מהמסך עצמו.
function describeFailure(status, data, text) {
  if (typeof data?.error === "string") return data.error;
  // סינון של ספק האינטרנט (נטפרי) עוצר את הבקשה לפני שהיא מגיעה לשרת.
  if (data?.blockByNetFree) {
    return "הבקשה נחסמה על ידי סינון נטפרי ולא הגיעה לשרת. יש לבקש מנטפרי לפתוח את כתובת האתר (כולל /api).";
  }
  // פורמט השגיאה של Vercel: { error: { code, message } }
  if (data?.error?.message) return `${data.error.message} (${data.error.code ?? status})`;

  const hint = {
    404: "נתיב ה-API לא נמצא בפריסה — ייתכן שפונקציית api/index.js לא נפרסה",
    405: "הבקשה לא הגיעה לשרת ה-API — ייתכן שפונקציית api/index.js לא נפרסה",
    500: "שגיאת שרת",
    502: "פונקציית השרת קרסה",
    503: "השרת לא זמין",
    504: "השרת לא הגיב בזמן — ייתכן שבסיס הנתונים לא זמין",
  }[status];
  const snippet = text && !data ? ` — ${text.slice(0, 120).trim()}` : "";
  return `${hint || "שגיאה בלתי צפויה"} (HTTP ${status})${snippet}. בדוק את /api/health`;
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב.");
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* גוף שאינו JSON — מטופל למטה */
  }

  if (!res.ok) {
    const err = new Error(describeFailure(res.status, data, text));
    err.status = res.status;
    throw err;
  }
  if (text && data === null) {
    throw new Error("השרת החזיר תשובה שאינה JSON. בדוק את /api/health");
  }
  return data;
}

export const api = {
  me: () => request("GET", "/auth/me"),
  members: () => request("GET", "/auth/members"),
  adminLogin: (password) => request("POST", "/auth/admin-login", { password }),
  memberLogin: (userId, password) => request("POST", "/auth/member-login", { userId, password }),
  logout: () => request("POST", "/auth/logout"),

  listProjects: () => request("GET", "/projects"),
  createProject: (name) => request("POST", "/projects", { name }),
  updateProject: (id, patch) => request("PATCH", `/projects/${id}`, patch),
  deleteProject: (id) => request("DELETE", `/projects/${id}`),

  listUsers: () => request("GET", "/users"),
  createUser: (name, password, role) => request("POST", "/users", { name, password, role }),
  deleteUser: (id) => request("DELETE", `/users/${id}`),

  setPermission: (userId, projectId, level) =>
    request("PUT", "/permissions", { userId, projectId, level }),
  setAdminPassword: (newPassword) => request("PUT", "/admin/password", { newPassword }),

  handoff: (id, stage, userId) => request("POST", `/projects/${id}/handoff`, { stage, userId }),

  listNotes: (id) => request("GET", `/projects/${id}/notes`),
  addNote: (id, note) => request("POST", `/projects/${id}/notes`, note),
  updateNote: (id, noteId, patch) => request("PATCH", `/projects/${id}/notes/${noteId}`, patch),
  deleteNote: (id, noteId) => request("DELETE", `/projects/${id}/notes/${noteId}`),
  addNoteGroup: (id, group) => request("POST", `/projects/${id}/notes/groups`, group),
  deleteNoteGroup: (id, groupId) => request("DELETE", `/projects/${id}/notes/groups/${groupId}`),

  repoStatus: (id) => request("GET", `/projects/${id}/github`),
  syncIssues: (id) => request("POST", `/projects/${id}/github/sync`),

  generateCopy: (projectId) => request("POST", "/ai/project-copy", { projectId }),
  scanCode: (projectId) => request("POST", "/ai/scan", { projectId }),
  generateBrief: (projectId) => request("POST", "/ai/brief", { projectId }),
  buildChecklist: (projectId) => request("POST", "/ai/checklist", { projectId }),
};
