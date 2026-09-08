import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { C, input, primaryButton } from "../theme.js";

const LEVELS = [
  { key: "none", label: "אין גישה" },
  { key: "view", label: "צפייה" },
  { key: "edit", label: "עריכה" },
];

// התפקידים שהמנהל יכול להקצות. «מנהל» לא מופיע כאן — חשבון מנהל נוצר
// בזריעה הראשונה בלבד.
export const ROLES = {
  member: "איש צוות",
  marketing: "שיווק",
  developer: "מתכנת",
};

export default function TeamView({ onError }) {
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openUserId, setOpenUserId] = useState(null);

  const [newName, setNewName] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [adminPass, setAdminPass] = useState("");
  const [adminPass2, setAdminPass2] = useState("");
  const [passNotice, setPassNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [u, p] = await Promise.all([api.listUsers(), api.listProjects()]);
      setUsers(u);
      setProjects(p);
    } catch (err) {
      onError(err);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function addUser() {
    try {
      const created = await api.createUser(newName.trim(), newPass, newRole);
      setUsers((prev) => [...prev, created]);
      setNewName("");
      setNewPass("");
      setNewRole("member");
    } catch (err) {
      onError(err);
    }
  }

  async function removeUser(user) {
    if (!window.confirm(`למחוק את ${user.name}? כל ההרשאות שלו יימחקו.`)) return;
    try {
      await api.deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      if (openUserId === user.id) setOpenUserId(null);
    } catch (err) {
      onError(err);
    }
  }

  async function setPermission(userId, projectId, level) {
    const previous = users;
    // Optimistic: the toggle should feel instant, and a failure restores it.
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        const permissions = { ...u.permissions };
        if (level === "none") delete permissions[projectId];
        else permissions[projectId] = level;
        return { ...u, permissions };
      })
    );
    try {
      await api.setPermission(userId, projectId, level);
    } catch (err) {
      setUsers(previous);
      onError(err);
    }
  }

  async function changeAdminPassword(e) {
    e.preventDefault();
    setPassNotice("");
    if (adminPass !== adminPass2) {
      setPassNotice("הסיסמאות אינן תואמות");
      return;
    }
    try {
      await api.setAdminPassword(adminPass);
      setAdminPass("");
      setAdminPass2("");
      setPassNotice("סיסמת המנהל עודכנה. כל שאר החיבורים הקיימים בוטלו.");
    } catch (err) {
      onError(err);
    }
  }

  if (loading) return <div style={{ color: C.muted }}>טוען...</div>;

  return (
    <div>
      <section style={{ marginBottom: "24px", padding: "16px", background: C.surface, border: `1px solid ${C.line}` }}>
        <h2 style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 10px" }}>שינוי סיסמת מנהל</h2>
        <form onSubmit={changeAdminPassword} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            type="password"
            value={adminPass}
            onChange={(e) => setAdminPass(e.target.value)}
            placeholder="סיסמה חדשה (8 תווים לפחות)"
            autoComplete="new-password"
            style={{ ...input, flex: 1, minWidth: "180px" }}
          />
          <input
            type="password"
            value={adminPass2}
            onChange={(e) => setAdminPass2(e.target.value)}
            placeholder="אימות סיסמה"
            autoComplete="new-password"
            style={{ ...input, flex: 1, minWidth: "180px" }}
          />
          <button type="submit" disabled={adminPass.length < 8} style={primaryButton}>
            עדכן
          </button>
        </form>
        {passNotice && <div style={{ fontSize: "12px", color: C.muted, marginTop: "8px" }}>{passNotice}</div>}
      </section>

      <section style={{ marginBottom: "20px", padding: "16px", background: C.surface, border: `1px solid ${C.line}` }}>
        <h2 style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 10px" }}>הוספת איש צוות</h2>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="שם"
            style={{ ...input, flex: 1, minWidth: "120px" }}
          />
          <input
            type="password"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            placeholder="סיסמה (6 תווים לפחות)"
            autoComplete="new-password"
            style={{ ...input, flex: 1, minWidth: "120px" }}
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            aria-label="תפקיד"
            style={{ ...input, minWidth: "120px" }}
          >
            {Object.entries(ROLES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button onClick={addUser} disabled={!newName.trim() || newPass.length < 6} style={primaryButton}>
            <Plus size={15} /> הוסף
          </button>
        </div>
      </section>

      {users.length === 0 ? (
        <div style={{ padding: "30px 20px", textAlign: "center", color: C.muted, border: `1px dashed ${C.line}` }}>
          עדיין אין אנשי צוות.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: C.line }}>
          {users.map((u) => {
            const open = openUserId === u.id;
            const count = Object.keys(u.permissions ?? {}).length;
            return (
              <div key={u.id} style={{ background: C.surface }}>
                <div
                  onClick={() => setOpenUserId(open ? null : u.id)}
                  style={{
                    padding: "14px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        background: C.lineSoft,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      {u.name.trim()[0] ?? "?"}
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 600 }}>
                      {u.name}
                      <span style={{ fontSize: "11px", color: C.muted, fontWeight: 400, marginInlineStart: "8px" }}>
                        {ROLES[u.role] ?? u.role}
                      </span>
                    </div>
                    <div style={{ fontSize: "12px", color: C.muted }}>{count} פרויקטים</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeUser(u);
                      }}
                      aria-label="מחק איש צוות"
                      style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}
                    >
                      <Trash2 size={15} />
                    </button>
                    <ChevronLeft
                      size={16}
                      style={{ transform: open ? "rotate(-90deg)" : "rotate(180deg)", transition: "transform 0.15s" }}
                    />
                  </div>
                </div>

                {open && (
                  <div style={{ padding: "0 16px 16px", background: "#fbfaf7" }}>
                    {projects.length === 0 ? (
                      <div style={{ fontSize: "13px", color: C.muted }}>אין פרויקטים להקצות עדיין.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {projects.map((p) => {
                          const level = u.permissions?.[p.id] ?? "none";
                          return (
                            <div
                              key={p.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "10px",
                                padding: "8px 0",
                                borderTop: `1px solid ${C.lineSoft}`,
                              }}
                            >
                              <span style={{ fontSize: "13px" }}>{p.name}</span>
                              <div style={{ display: "flex", border: `1px solid ${C.line}`, flexShrink: 0 }}>
                                {LEVELS.map((opt) => (
                                  <button
                                    key={opt.key}
                                    onClick={() => setPermission(u.id, p.id, opt.key)}
                                    style={{
                                      padding: "5px 10px",
                                      fontSize: "12px",
                                      border: "none",
                                      borderLeft: opt.key !== "edit" ? `1px solid ${C.line}` : "none",
                                      cursor: "pointer",
                                      background: level === opt.key ? C.ink : "transparent",
                                      color: level === opt.key ? C.bg : C.ink,
                                    }}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
