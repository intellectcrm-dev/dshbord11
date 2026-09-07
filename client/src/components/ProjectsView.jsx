import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { C, STATUS, input, primaryButton } from "../theme.js";

const SAVE_DELAY = 600;

export default function ProjectsView({ session, onError }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const pending = useRef(new Map());

  const isAdmin = session.role === "admin";

  const load = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (err) {
      onError(err);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const patchLocal = useCallback((id, patch) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  // Typing a description or nudging a progress number should not fire one
  // request per keystroke: update locally, coalesce the fields, send once.
  const queueSave = useCallback(
    (id, patch, { immediate = false } = {}) => {
      patchLocal(id, patch);

      const entry = pending.current.get(id) ?? { patch: {}, timer: null };
      entry.patch = { ...entry.patch, ...patch };
      if (entry.timer) clearTimeout(entry.timer);

      const flush = async () => {
        const body = entry.patch;
        pending.current.delete(id);
        try {
          const updated = await api.updateProject(id, body);
          patchLocal(id, updated);
        } catch (err) {
          onError(err);
          load();
        }
      };

      entry.timer = setTimeout(flush, immediate ? 0 : SAVE_DELAY);
      pending.current.set(id, entry);
    },
    [load, onError, patchLocal]
  );

  // Do not lose an in-flight edit when the view unmounts (tab switch, logout).
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const [id, entry] of map) {
        clearTimeout(entry.timer);
        api.updateProject(id, entry.patch).catch(() => {});
      }
      map.clear();
    };
  }, []);

  async function addProject() {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await api.createProject(name);
      setProjects((prev) => [...prev, created]);
      setNewName("");
    } catch (err) {
      onError(err);
    }
  }

  async function removeProject(project) {
    if (!window.confirm(`למחוק את הפרויקט "${project.name}"? הפעולה אינה הפיכה.`)) return;
    try {
      await api.deleteProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (err) {
      onError(err);
    }
  }

  if (loading) return <div style={{ color: C.muted }}>טוען פרויקטים...</div>;

  return (
    <>
      {isAdmin && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addProject()}
            placeholder="שם פרויקט חדש"
            style={{ ...input, flex: 1 }}
          />
          <button onClick={addProject} style={primaryButton}>
            <Plus size={16} /> הוסף
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: C.muted, border: `1px dashed ${C.line}` }}>
          {isAdmin
            ? "אין עדיין פרויקטים. הוסף את הראשון למעלה."
            : "אין לך עדיין גישה לאף פרויקט. פנה למנהל."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: C.line }}>
          {projects.map((p) => {
            const editable = p.level === "admin" || p.level === "edit";
            const st = STATUS[p.status] ?? STATUS.active;
            return (
              <article
                key={p.id}
                style={{
                  background: C.surface,
                  padding: "16px",
                  borderRight: `4px solid ${st.color}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                  {editingId === p.id ? (
                    <input
                      value={p.name}
                      onChange={(e) => patchLocal(p.id, { name: e.target.value })}
                      onBlur={() => {
                        setEditingId(null);
                        queueSave(p.id, { name: p.name.trim() || "ללא שם" }, { immediate: true });
                      }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      autoFocus
                      style={{ fontSize: "16px", fontWeight: 600, border: `1px solid ${C.line}`, padding: "4px 8px", flex: 1 }}
                    />
                  ) : (
                    <h2
                      onClick={() => isAdmin && setEditingId(p.id)}
                      title={isAdmin ? "לחץ לשינוי שם" : undefined}
                      style={{ fontSize: "16px", fontWeight: 600, margin: 0, cursor: isAdmin ? "text" : "default" }}
                    >
                      {p.name}
                    </h2>
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    {!editable && <Eye size={14} color={C.muted} aria-label="צפייה בלבד" />}
                    {editable && !isAdmin && <Pencil size={14} color={C.muted} aria-label="ניתן לערוך" />}
                    {editable ? (
                      <select
                        value={p.status}
                        onChange={(e) => queueSave(p.id, { status: e.target.value }, { immediate: true })}
                        aria-label="סטטוס"
                        style={{ fontSize: "12px", border: `1px solid ${C.line}`, padding: "4px 8px", background: "#fff", color: st.color }}
                      >
                        {Object.entries(STATUS).map(([key, v]) => (
                          <option key={key} value={key}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ fontSize: "12px", color: st.color, fontWeight: 600 }}>{st.label}</span>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => removeProject(p)}
                        aria-label="מחק פרויקט"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#b5b3a8", padding: "2px" }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {editable ? (
                  <textarea
                    value={p.description}
                    onChange={(e) => queueSave(p.id, { description: e.target.value })}
                    placeholder="תיאור, הערות, סטטוס..."
                    rows={2}
                    style={{
                      width: "100%",
                      border: `1px solid ${C.lineSoft}`,
                      padding: "8px",
                      fontSize: "13px",
                      resize: "vertical",
                      color: "#3d3d35",
                    }}
                  />
                ) : (
                  p.description && <p style={{ fontSize: "13px", color: C.muted, margin: 0 }}>{p.description}</p>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ flex: 1, height: "5px", background: C.lineSoft }}>
                    <div style={{ width: `${p.progress}%`, height: "100%", background: st.color }} />
                  </div>
                  {editable ? (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={p.progress}
                      aria-label="אחוז התקדמות"
                      onChange={(e) =>
                        queueSave(p.id, {
                          progress: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))),
                        })
                      }
                      style={{ width: "56px", fontSize: "12px", border: `1px solid ${C.line}`, padding: "3px", textAlign: "center" }}
                    />
                  ) : (
                    <span style={{ fontSize: "12px", color: C.muted, width: "34px" }}>{p.progress}%</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
