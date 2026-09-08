import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Eye,
  ImagePlus,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api.js";
import { C, STATUS, ghostButton, input, primaryButton } from "../theme.js";

const SAVE_DELAY = 600;

// גבול ההקטנה בצד הלקוח. תמונה גדולה יותר לא מוסיפה דבר בתצוגה של 58px
// ורק מנפחת את בסיס הנתונים, ולכן היא מוקטנת לפני שהיא נשלחת בכלל.
const MAX_IMAGE_EDGE = 1200;
const IMAGE_QUALITY = 0.72;

async function shrinkToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
}

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
  const shared = {
    width: "58px",
    height: "58px",
    borderRadius: C.radius,
    flexShrink: 0,
    objectFit: "cover",
  };

  if (project.image_url) {
    return <img src={project.image_url} alt="" style={shared} />;
  }
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

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      <span style={{ fontSize: "11.5px", color: C.muted, letterSpacing: ".02em" }}>{label}</span>
      {children}
    </label>
  );
}

export default function ProjectsView({ session, onError }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const pending = useRef(new Map());
  const fileInputs = useRef(new Map());

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

  async function pickImage(project, file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError(new Error("אפשר להעלות קובץ תמונה בלבד."));
      return;
    }
    setBusyId(project.id);
    try {
      queueSave(project.id, { image: await shrinkToDataUrl(file) }, { immediate: true });
    } catch {
      onError(new Error("לא הצלחנו לקרוא את קובץ התמונה. נסה קובץ אחר."));
    } finally {
      setBusyId(null);
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
            : "אין לך עדיין גישה לאף פרויקט. פנה למנהל."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {projects.map((p) => {
            const editable = p.level === "admin" || p.level === "edit";
            const st = STATUS[p.status] ?? STATUS.active;
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
                <div style={{ display: "flex", gap: "14px", alignItems: "center", padding: "14px 16px" }}>
                  <Thumb project={p} color={st.color} />

                  <div style={{ flex: 1, minWidth: 0 }}>
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
                        style={{ ...input, fontSize: "16px", fontWeight: 700, width: "100%" }}
                      />
                    ) : (
                      <h2
                        onClick={() => isAdmin && setEditingId(p.id)}
                        title={isAdmin ? "לחץ לשינוי שם" : undefined}
                        style={{
                          fontSize: "16px",
                          fontWeight: 700,
                          margin: "0 0 2px",
                          cursor: isAdmin ? "text" : "default",
                        }}
                      >
                        {p.name}
                      </h2>
                    )}

                    {p.description && (
                      <p
                        style={{
                          fontSize: "12.5px",
                          color: C.muted,
                          margin: "0 0 6px",
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

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: "5px 12px",
                        fontSize: "11.5px",
                      }}
                    >
                      {editable ? (
                        <select
                          value={p.status}
                          onChange={(e) => queueSave(p.id, { status: e.target.value }, { immediate: true })}
                          aria-label="סטטוס"
                          style={{
                            ...input,
                            padding: "3px 7px",
                            fontSize: "11.5px",
                            color: st.color,
                            borderRadius: "6px",
                          }}
                        >
                          {Object.entries(STATUS).map(([key, v]) => (
                            <option key={key} value={key} style={{ color: C.ink, background: C.surfaceAlt }}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: C.muted }}>
                          <i
                            style={{
                              width: "7px",
                              height: "7px",
                              borderRadius: "50%",
                              background: st.color,
                              display: "inline-block",
                            }}
                          />
                          {st.label}
                        </span>
                      )}

                      {p.link && (
                        <a
                          href={p.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: C.accent,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            textDecoration: "none",
                          }}
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

                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
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
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: C.muted,
                          padding: "2px",
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {open && (
                  <div
                    style={{
                      borderTop: `1px solid ${C.line}`,
                      background: C.bg,
                      padding: "14px 16px",
                      display: "grid",
                      gap: "12px",
                    }}
                  >
                    {editable ? (
                      <>
                        <Field label="תיאור">
                          <textarea
                            value={p.description}
                            onChange={(e) => queueSave(p.id, { description: e.target.value })}
                            placeholder="על מה הפרויקט, מה השלב הנוכחי, מה חסם"
                            rows={3}
                            style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.55 }}
                          />
                        </Field>

                        <Field label="אפיון קהל יעד">
                          <input
                            value={p.audience ?? ""}
                            onChange={(e) => queueSave(p.id, { audience: e.target.value })}
                            placeholder="מי הקהל, באיזה גיל, מה מניע אותו לפעולה"
                            style={{ ...input, width: "100%" }}
                          />
                        </Field>

                        <div
                          style={{
                            display: "grid",
                            gap: "12px",
                            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                          }}
                        >
                          <Field label="קישור">
                            <input
                              value={p.link ?? ""}
                              onChange={(e) => patchLocal(p.id, { link: e.target.value })}
                              onBlur={(e) => queueSave(p.id, { link: e.target.value.trim() }, { immediate: true })}
                              placeholder="example.co.il"
                              dir="ltr"
                              style={{ ...input, width: "100%", textAlign: "left" }}
                            />
                          </Field>

                          <Field label="תמונה">
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              <input
                                ref={(el) => fileInputs.current.set(p.id, el)}
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={(e) => {
                                  pickImage(p, e.target.files?.[0]);
                                  e.target.value = "";
                                }}
                              />
                              <button
                                onClick={() => fileInputs.current.get(p.id)?.click()}
                                disabled={busy}
                                style={ghostButton}
                              >
                                <ImagePlus size={14} /> העלה מהמחשב
                              </button>
                              {p.image_url && (
                                <button
                                  onClick={() => queueSave(p.id, { image: "" }, { immediate: true })}
                                  style={{ ...ghostButton, color: C.danger }}
                                >
                                  <X size={14} /> הסר
                                </button>
                              )}
                            </div>
                          </Field>
                        </div>

                        <Field label="או הדבק כתובת של תמונה">
                          <input
                            defaultValue={p.image_url?.startsWith("http") ? p.image_url : ""}
                            onBlur={(e) => {
                              const value = e.target.value.trim();
                              if (value) queueSave(p.id, { image: value }, { immediate: true });
                            }}
                            placeholder="https://…/logo.png"
                            dir="ltr"
                            style={{ ...input, width: "100%", textAlign: "left" }}
                          />
                        </Field>

                        <Field label="התקדמות">
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={p.progress}
                              aria-label="אחוז התקדמות"
                              onChange={(e) => queueSave(p.id, { progress: Number(e.target.value) })}
                              style={{ flex: 1, accentColor: C.accent }}
                            />
                            <span
                              style={{
                                fontSize: "13px",
                                width: "42px",
                                textAlign: "left",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {p.progress}%
                            </span>
                          </div>
                        </Field>
                      </>
                    ) : (
                      <p style={{ margin: 0, fontSize: "13px", color: C.muted, lineHeight: 1.6 }}>
                        {p.description || "אין עדיין תיאור לפרויקט הזה."}
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
