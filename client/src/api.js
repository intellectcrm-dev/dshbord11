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
  createUser: (name, password) => request("POST", "/users", { name, password }),
  deleteUser: (id) => request("DELETE", `/users/${id}`),

  setPermission: (userId, projectId, level) =>
    request("PUT", "/permissions", { userId, projectId, level }),
  setAdminPassword: (newPassword) => request("PUT", "/admin/password", { newPassword }),

  generateCopy: (projectId) => request("POST", "/ai/project-copy", { projectId }),
};
