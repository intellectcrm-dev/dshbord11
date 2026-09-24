import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Eye, Link2, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { C, STATUS, input, primaryButton } from "../theme.js";
import ProjectDetails, { STAGES } from "./ProjectDetails.jsx";

const SAVE_DELAY = 600;

function Ring({ value, color }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  return (
    <div style={{ position: "relative", width: "44px", height: "44px", flexShrink: 0 }}>
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
        <circle cx="22" cy="22" r={radius} fill="none" stroke={C.line} strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, value)) / 100)}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          fontSize: "11px",
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}%
      </span>
    </div>
  );
}

// כשאין תמונה מוצג ריבוע בצבע הסטטוס עם האות הראשונה — משאיר את הרשימה
// אחידה במקום חור מלבני, ועדיין מבדיל בין פרויקטים.
function Thumb({ project, color }) {
  const shared = { width: "58px", height: "58px", borderRadius: C.radius, flexShrink: 0, objectFit: "cover" };

  if (project.image_url) return <img src={project.image_url} alt="" style={shared} />;
  return (
    <div
      aria-hidden="true"
      style={{
        ...shared,
        display: "grid",
        placeItems: "center",
        background: C.surfaceAlt,
        border: `1px solid ${C.line}`,
        color,
        fontSize: "20px",
        fontWeight: 700,
      }}
    >
      {project.name.trim().charAt(0) || "?"}
    </div>
  );
}

export default function ProjectsView({ session, onError }) {
  const [projects, setProjects] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
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

  // רשימת הצוות דרושה רק כדי לבחור למי מעבירים, ולכן היא נטענת למנהל בלבד.
  useEffect(() => {
    if (!isAdmin) return;
    api.listUsers().then(setTeam).catch(onError);
  }, [isAdmin, onError]);

  const patchLocal = useCallback((id, patch) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const replaceProject = useCallback((next) => {
    setProjects((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...next } : p)));
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
      setOpenId(created.id);
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

  async function writeWithAi(project) {
    setBusyId(project.id);
    try {
      const { description, audience } = await api.generateCopy(project.id);
      queueSave(project.id, { description, audience }, { immediate: true });
      setOpenId(project.id);
    } catch (err) {
      onError(err);
    } finally {
      setBusyId(null);
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
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: C.muted,
            border: `1px dashed ${C.line}`,
            borderRadius: C.radius,
          }}
        >
          {isAdmin
            ? "אין עדיין פרויקטים. הוסף את הראשון למעלה."
            : "לא הועבר אליך אף פרויקט עדיין."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {projects.map((p) => {
            const editable = p.level === "admin" || p.level === "edit";
            const st = STATUS[p.status] ?? STATUS.active;
            const stage = STAGES[p.stage] ?? STAGES.draft;
            const open = openId === p.id;
            const busy = busyId === p.id;

            return (
              <article
                key={p.id}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.line}`,
                  borderRadius: C.radius,
                  overflow: "hidden",
                }}
              >
                <div className="pcard-head">
                  <Thumb project={p} color={st.color} />

                  <div className="pcard-info">
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
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
                          style={{ ...input, fontSize: "16px", fontWeight: 700, flex: 1 }}
                        />
                      ) : (
                        <h2
                          onClick={() => isAdmin && setEditingId(p.id)}
                          title={isAdmin ? "לחץ לשינוי שם" : undefined}
                          style={{ fontSize: "16px", fontWeight: 700, margin: 0, cursor: isAdmin ? "text" : "default" }}
                        >
                          {p.name}
                        </h2>
                      )}

                      <span
                        style={{
                          fontSize: "10.5px",
                          padding: "2px 8px",
                          borderRadius: "99px",
                          color: stage.color,
                          border: `1px solid ${stage.color}55`,
                        }}
                      >
                        {stage.label}
                      </span>

                      {p.open_notes > 0 && (
                        <span style={{ fontSize: "10.5px", padding: "2px 8px", borderRadius: "99px", color: C.danger, border: `1px solid ${C.danger}55` }}>
                          {p.open_notes} לתיקון
                        </span>
                      )}
                    </div>

                    {p.description && (
                      <p
                        style={{
                          fontSize: "12.5px",
                          color: C.muted,
                          margin: "3px 0 6px",
                          lineHeight: 1.5,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {p.description}
                      </p>
                    )}

                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "5px 12px", fontSize: "11.5px" }}>
                      {editable ? (
                        <select
                          value={p.status}
                          onChange={(e) => queueSave(p.id, { status: e.target.value }, { immediate: true })}
                          aria-label="סטטוס"
                          style={{ ...input, padding: "3px 7px", fontSize: "11.5px", color: st.color, borderRadius: "6px" }}
                        >
                          {Object.entries(STATUS).map(([key, v]) => (
                            <option key={key} value={key} style={{ color: C.ink, background: C.surfaceAlt }}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: C.muted }}>
                          <i style={{ width: "7px", height: "7px", borderRadius: "50%", background: st.color, display: "inline-block" }} />
                          {st.label}
                        </span>
                      )}

                      {p.link && (
                        <a
                          href={p.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: C.accent, display: "inline-flex", alignItems: "center", gap: "4px", textDecoration: "none" }}
                        >
                          <Link2 size={12} />
                          {p.link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                        </a>
                      )}

                      {p.audience && (
                        <span style={{ color: C.muted }}>
                          קהל יעד: <b style={{ color: C.inkSoft, fontWeight: 500 }}>{p.audience}</b>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="pcard-controls">
                    {!editable && <Eye size={14} color={C.muted} aria-label="צפייה בלבד" />}
                    {editable && !isAdmin && <Pencil size={14} color={C.muted} aria-label="ניתן לערוך" />}

                    <Ring value={p.progress} color={st.color} />

                    {editable && (
                      <button
                        onClick={() => writeWithAi(p)}
                        disabled={busy}
                        title="קלוד יכתוב תיאור וקהל יעד לפי שם הפרויקט"
                        style={{ ...primaryButton, padding: "6px 11px", fontSize: "12.5px" }}
                      >
                        {busy ? <Loader2 size={14} /> : <Sparkles size={14} />} AI
                      </button>
                    )}

                    <button
                      onClick={() => setOpenId(open ? null : p.id)}
                      aria-label={open ? "סגור פרטים" : "פתח פרטים"}
                      aria-expanded={open}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: C.muted,
                        padding: "2px",
                        display: "grid",
                        placeItems: "center",
                        transform: open ? "rotate(180deg)" : "none",
                      }}
                    >
                      <ChevronDown size={18} />
                    </button>

                    {isAdmin && (
                      <button
                        onClick={() => removeProject(p)}
                        aria-label="מחק פרויקט"
                        style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: "2px" }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {open && (
                  <ProjectDetails
                    project={p}
                    isAdmin={isAdmin}
                    team={team}
                    queueSave={queueSave}
                    patchLocal={patchLocal}
                    onError={onError}
                    onReplace={replaceProject}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
