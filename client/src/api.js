async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = new Error(data?.error || "שגיאה בלתי צפויה");
    err.status = res.status;
    throw err;
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
