import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  GitBranch,
  ImagePlus,
  Loader2,
  Megaphone,
  RefreshCw,
  ListChecks,
  ScanSearch,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { api } from "../api.js";
import { C, ghostButton, input, primaryButton } from "../theme.js";

export const STAGES = {
  draft: { label: "טיוטה", color: C.muted, hint: "גלוי לך בלבד" },
  marketing: { label: "אצל השיווק", color: "#7FB2E5", hint: "הועבר לקידום" },
  dev: { label: "אצל המתכנת", color: "#E3A44B", hint: "ממתין לתיקונים" },
  done: { label: "הושלם", color: "#5FBF8A", hint: "סגור" },
};

const SEVERITY = {
  critical: { label: "קריטי", color: "#E0685A" },
  warning: { label: "לתיקון", color: "#E3A44B" },
  info: { label: "לשיפור", color: "#7FB2E5" },
};

const SOURCE = { manual: "ידני", github: "GitHub", ai: "סריקה" };

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

function Section({ title, aside, children }) {
  return (
    <section style={{ display: "grid", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
        <h3 style={{ fontSize: "12px", fontWeight: 700, margin: 0, color: C.inkSoft, letterSpacing: ".03em" }}>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      <span style={{ fontSize: "11.5px", color: C.muted }}>{label}</span>
      {children}
    </label>
  );
}

// סרגל התקדמות. אותו רכיב משרת גם את הרשימה כולה וגם קבוצה בודדת.
function Meter({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div style={{ flex: 1, height: "6px", borderRadius: "99px", background: C.line, overflow: "hidden" }}>
        <i
          style={{
            display: "block",
            height: "100%",
            width: `${pct}%`,
            background: C.accent,
            borderRadius: "99px",
            transition: "width .3s ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: "11.5px",
          color: C.muted,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {done} / {total} הושלמו
      </span>
    </div>
  );
}

function NoteRow({ note, editable, busy, onToggle, onRemove }) {
  const sev = SEVERITY[note.severity] ?? SEVERITY.info;
  return (
    <li
      style={{
        background: C.surface,
        border: `1px solid ${C.line}`,
        borderInlineStart: note.severity === "critical" && !note.done ? `3px solid ${sev.color}` : undefined,
        borderRadius: C.radius,
        padding: "10px 12px",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        opacity: note.done ? 0.55 : 1,
      }}
    >
      {editable && (
        <button
          onClick={() => onToggle(note)}
          disabled={busy === `note:${note.id}`}
          aria-label={note.done ? "החזר לפתוח" : "סמן כטופל"}
          style={{
            marginTop: "2px",
            width: "17px",
            height: "17px",
            flexShrink: 0,
            borderRadius: "5px",
            border: `1px solid ${note.done ? "#5FBF8A" : C.muted}`,
            background: note.done ? "#5FBF8A" : "transparent",
            color: C.accentInk,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            padding: 0,
          }}
        >
          {note.done && <Check size={12} />}
        </button>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "13.5px",
            fontWeight: 600,
            textDecoration: note.done ? "line-through" : "none",
          }}
        >
          {note.url ? (
            <a href={note.url} target="_blank" rel="noopener noreferrer" style={{ color: C.ink, textDecoration: "none" }}>
              {note.title}
            </a>
          ) : (
            note.title
          )}
        </div>
        {note.body && (
          <p style={{ margin: "4px 0 0", fontSize: "12.5px", color: C.muted, lineHeight: 1.55, maxWidth: "62ch" }}>
            {note.body}
          </p>
        )}
      </div>

      <span style={{ fontSize: "11px", color: sev.color, flexShrink: 0 }}>{sev.label}</span>
      <span style={{ fontSize: "11px", color: C.muted, flexShrink: 0 }}>{SOURCE[note.source]}</span>

      {editable && (
        <button
          onClick={() => onRemove(note)}
          aria-label="מחק הערה"
          style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: 0, flexShrink: 0 }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </li>
  );
}

// קבוצה אחת ברשימת המסירה. פריטים שלא שויכו לרשימה מוצגים באותו רכיב
// בלי כותרת שלב, כדי שהכול ייראה כרשימה אחת ולא כשתי מערכות.
function NoteGroup({ group, step, items, editable, busy, onToggle, onRemove, onRemoveGroup }) {
  const done = items.filter((n) => n.done).length;

  return (
    <section style={{ display: "grid", gap: "9px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "9px", flexWrap: "wrap" }}>
        {step && (
          <span style={{ fontSize: "11.5px", color: C.muted, fontVariantNumeric: "tabular-nums" }}>{step}</span>
        )}
        <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>{group ? group.title : "כללי"}</h4>
        <span style={{ fontSize: "11.5px", color: done === items.length ? "#5FBF8A" : C.muted }}>
          {done}/{items.length}
        </span>
        {group && editable && (
          <button
            onClick={() => onRemoveGroup(group)}
            disabled={busy === `group:${group.id}`}
            aria-label="מחק את הרשימה"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.muted,
              padding: 0,
              marginInlineStart: "auto",
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {group?.note && (
        <p style={{ margin: 0, fontSize: "12.5px", color: C.muted, lineHeight: 1.55, maxWidth: "62ch" }}>
          {group.note}
        </p>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
        {items.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            editable={editable}
            busy={busy}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </section>
  );
}

export default function ProjectDetails({ project, isAdmin, team, queueSave, patchLocal, onError, onReplace }) {
  const editable = project.level === "admin" || project.level === "edit";

  const [notes, setNotes] = useState([]);
  const [groups, setGroups] = useState([]);
  const [repo, setRepo] = useState(null);
  const [repoError, setRepoError] = useState("");
  const [scanSummary, setScanSummary] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteSeverity, setNoteSeverity] = useState("warning");
  const [noteGroupId, setNoteGroupId] = useState("");
  const [busy, setBusy] = useState("");
  const fileInput = useRef(null);

  const projectId = project.id;
  const repoUrl = project.repo_url;

  const loadNotes = useCallback(async () => {
    try {
      const data = await api.listNotes(projectId);
      setGroups(data.groups);
      setNotes(data.notes);
    } catch (err) {
      onError(err);
    }
  }, [projectId, onError]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // מצב הריפו נטען פעם אחת לכל פתיחה. כישלון כאן אינו שגיאת מערכת — הוא
  // בדרך כלל אומר שהאסימון חסר, ולכן הוא מוצג במקום ולא כהתראה גלובלית.
  useEffect(() => {
    let cancelled = false;
    if (!repoUrl) {
      setRepo(null);
      setRepoError("");
      return undefined;
    }
    api
      .repoStatus(projectId)
      .then((data) => !cancelled && (setRepo(data), setRepoError("")))
      .catch((err) => !cancelled && (setRepo(null), setRepoError(err.message)));
    return () => {
      cancelled = true;
    };
  }, [projectId, repoUrl]);

  async function run(key, action) {
    setBusy(key);
    try {
      await action();
    } catch (err) {
      onError(err);
    } finally {
      setBusy("");
    }
  }

  const addNote = () =>
    run("note", async () => {
      const title = noteTitle.trim();
      if (!title) return;
      const created = await api.addNote(projectId, { title, severity: noteSeverity, groupId: noteGroupId });
      setNotes((prev) => [created, ...prev]);
      setNoteTitle("");
      onReplace({ ...project, open_notes: (project.open_notes ?? 0) + 1 });
    });

  const toggleNote = (note) =>
    run(`note:${note.id}`, async () => {
      const updated = await api.updateNote(projectId, note.id, { done: !note.done });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      onReplace({ ...project, open_notes: (project.open_notes ?? 0) + (updated.done ? -1 : 1) });
    });

  const removeNote = (note) =>
    run(`note:${note.id}`, async () => {
      await api.deleteNote(projectId, note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      if (!note.done) onReplace({ ...project, open_notes: Math.max(0, (project.open_notes ?? 1) - 1) });
    });

  const syncIssues = () =>
    run("sync", async () => {
      await api.syncIssues(projectId);
      await loadNotes();
    });

  const scanCode = () =>
    run("scan", async () => {
      const result = await api.scanCode(projectId);
      setScanSummary(result.summary);
      await loadNotes();
    });

  const buildChecklist = () =>
    run("checklist", async () => {
      const result = await api.buildChecklist(projectId);
      setScanSummary(result.summary);
      await loadNotes();
      onReplace({ ...project, open_notes: (project.open_notes ?? 0) + result.items });
    });

  const addGroup = () =>
    run("group", async () => {
      const title = window.prompt("שם הרשימה החדשה:", "")?.trim();
      if (!title) return;
      const group = await api.addNoteGroup(projectId, { title });
      setGroups((prev) => [...prev, group]);
      setNoteGroupId(group.id);
    });

  const removeGroup = (group) =>
    run(`group:${group.id}`, async () => {
      if (!window.confirm(`למחוק את הרשימה «${group.title}» וכל הפריטים שבה?`)) return;
      await api.deleteNoteGroup(projectId, group.id);
      await loadNotes();
    });

  const writeBrief = () =>
    run("brief", async () => {
      const { brief } = await api.generateBrief(projectId);
      patchLocal(projectId, { brief });
    });

  const handoff = (stage, userId) =>
    run("handoff", async () => {
      onReplace(await api.handoff(projectId, stage, userId));
    });

  const pickImage = (file) =>
    run("image", async () => {
      if (!file) return;
      if (!file.type.startsWith("image/")) throw new Error("אפשר להעלות קובץ תמונה בלבד.");
      queueSave(projectId, { image: await shrinkToDataUrl(file) }, { immediate: true });
    });

  const openNotes = notes.filter((n) => !n.done);

  // הקבוצות לפי סדרן, ואחריהן מה שלא שויך לאף רשימה. קבוצה ריקה לא מוצגת.
  const grouped = [
    ...groups.map((group) => ({ group, items: notes.filter((n) => n.group_id === group.id) })),
    { group: null, items: notes.filter((n) => !n.group_id) },
  ].filter((entry) => entry.items.length > 0);
  const marketers = team.filter((u) => u.role === "marketing" || u.role === "member");
  const developers = team.filter((u) => u.role === "developer" || u.role === "member");

  return (
    <div
      style={{
        borderTop: `1px solid ${C.line}`,
        background: C.bg,
        padding: "16px",
        display: "grid",
        gap: "22px",
      }}
    >
      {/* ---------------- פרטים ---------------- */}
      {editable ? (
        <Section title="פרטים">
          <Field label="תיאור">
            <textarea
              value={project.description}
              onChange={(e) => queueSave(projectId, { description: e.target.value })}
              placeholder="על מה הפרויקט, מה השלב הנוכחי, מה חסם"
              rows={3}
              style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.55 }}
            />
          </Field>

          <Field label="אפיון קהל יעד">
            <input
              value={project.audience ?? ""}
              onChange={(e) => queueSave(projectId, { audience: e.target.value })}
              placeholder="מי הקהל, באיזה גיל, מה מניע אותו לפעולה"
              style={{ ...input, width: "100%" }}
            />
          </Field>

          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Field label="קישור לאתר">
              <input
                defaultValue={project.link ?? ""}
                onBlur={(e) => queueSave(projectId, { link: e.target.value.trim() }, { immediate: true })}
                placeholder="example.co.il"
                dir="ltr"
                style={{ ...input, width: "100%", textAlign: "left" }}
              />
            </Field>

            <Field label="קישור לריפו בגיטהאב">
              <input
                defaultValue={project.repo_url ?? ""}
                onBlur={(e) => queueSave(projectId, { repo_url: e.target.value.trim() }, { immediate: true })}
                placeholder="github.com/owner/repo"
                dir="ltr"
                style={{ ...input, width: "100%", textAlign: "left" }}
              />
            </Field>
          </div>

          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Field label="תמונה">
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    pickImage(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button onClick={() => fileInput.current?.click()} disabled={busy === "image"} style={ghostButton}>
                  <ImagePlus size={14} /> העלה מהמחשב
                </button>
                {project.image_url && (
                  <button
                    onClick={() => queueSave(projectId, { image: "" }, { immediate: true })}
                    style={{ ...ghostButton, color: C.danger }}
                  >
                    <X size={14} /> הסר
                  </button>
                )}
              </div>
            </Field>

            <Field label="או הדבק כתובת של תמונה">
              <input
                defaultValue={project.image_url?.startsWith("http") ? project.image_url : ""}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value) queueSave(projectId, { image: value }, { immediate: true });
                }}
                placeholder="https://…/logo.png"
                dir="ltr"
                style={{ ...input, width: "100%", textAlign: "left" }}
              />
            </Field>
          </div>

          <Field label="התקדמות">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type="range"
                min={0}
                max={100}
                value={project.progress}
                aria-label="אחוז התקדמות"
                onChange={(e) => queueSave(projectId, { progress: Number(e.target.value) })}
                style={{ flex: 1, accentColor: C.accent }}
              />
              <span style={{ fontSize: "13px", width: "42px", textAlign: "left", fontVariantNumeric: "tabular-nums" }}>
                {project.progress}%
              </span>
            </div>
          </Field>
        </Section>
      ) : (
        <p style={{ margin: 0, fontSize: "13px", color: C.muted, lineHeight: 1.6 }}>
          {project.description || "אין עדיין תיאור לפרויקט הזה."}
        </p>
      )}

      {/* ---------------- מצב הריפו ---------------- */}
      {project.repo_url && (
        <Section
          title="מצב הריפו"
          aside={
            editable && (
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={syncIssues} disabled={busy === "sync"} style={ghostButton}>
                  {busy === "sync" ? <Loader2 size={13} /> : <RefreshCw size={13} />} משוך Issues
                </button>
                <button onClick={scanCode} disabled={busy === "scan"} style={ghostButton}>
                  {busy === "scan" ? <Loader2 size={13} /> : <ScanSearch size={13} />} סרוק קוד
                </button>
              </div>
            )
          }
        >
          {repoError ? (
            <p style={{ margin: 0, fontSize: "12.5px", color: C.muted }}>{repoError}</p>
          ) : !repo ? (
            <p style={{ margin: 0, fontSize: "12.5px", color: C.muted }}>טוען מצב…</p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: "12.5px" }}>
              <span style={{ color: C.muted }}>
                <GitBranch size={12} style={{ verticalAlign: "-1px" }} /> {repo.full_name} · {repo.default_branch}
              </span>
              {repo.last_commit && (
                <a
                  href={repo.last_commit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: C.accent, textDecoration: "none" }}
                >
                  {repo.last_commit.message.slice(0, 60)}
                </a>
              )}
              <span style={{ color: C.muted }}>{repo.open_issues} issues פתוחים</span>
              {repo.checks && (
                <span style={{ color: repo.checks.conclusion === "success" ? "#5FBF8A" : C.danger }}>
                  בדיקות: {repo.checks.conclusion ?? repo.checks.status}
                </span>
              )}
            </div>
          )}
          {scanSummary && (
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                lineHeight: 1.6,
                color: C.inkSoft,
                background: C.surface,
                border: `1px solid ${C.line}`,
                borderRadius: C.radius,
                padding: "10px 12px",
              }}
            >
              {scanSummary}
            </p>
          )}
        </Section>
      )}

      {/* ---------------- הערות ורשימת מסירה ---------------- */}
      <Section
        title={`הערות ותיקונים · ${openNotes.length} מתוך ${notes.length} פתוחות`}
        aside={
          editable && (
            <div style={{ display: "flex", gap: "6px" }}>
              <button onClick={addGroup} disabled={busy === "group"} style={ghostButton}>
                + רשימה חדשה
              </button>
              {project.repo_url && (
                <button onClick={buildChecklist} disabled={busy === "checklist"} style={ghostButton}>
                  {busy === "checklist" ? <Loader2 size={13} /> : <ListChecks size={13} />} בנה רשימה עם AI
                </button>
              )}
            </div>
          )
        }
      >
        {notes.length > 0 && <Meter done={notes.length - openNotes.length} total={notes.length} />}

        {editable && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <input
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNote()}
              placeholder="מה צריך לתקן"
              style={{ ...input, flex: 1, minWidth: "180px" }}
            />
            <select
              value={noteGroupId}
              onChange={(e) => setNoteGroupId(e.target.value)}
              aria-label="שיוך לרשימה"
              style={{ ...input, minWidth: "130px" }}
            >
              <option value="">כללי</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            <select
              value={noteSeverity}
              onChange={(e) => setNoteSeverity(e.target.value)}
              aria-label="חומרה"
              style={{ ...input, minWidth: "110px" }}
            >
              {Object.entries(SEVERITY).map(([key, v]) => (
                <option key={key} value={key}>
                  {v.label}
                </option>
              ))}
            </select>
            <button onClick={addNote} disabled={!noteTitle.trim() || busy === "note"} style={ghostButton}>
              הוסף
            </button>
          </div>
        )}

        {notes.length === 0 ? (
          <p style={{ margin: 0, fontSize: "12.5px", color: C.muted }}>
            {project.repo_url
              ? "אין עדיין הערות. אפשר להוסיף ידנית, למשוך Issues, או לבנות רשימת מסירה מהקוד."
              : "אין עדיין הערות. הוסף קישור לריפו כדי לבנות רשימה מהקוד."}
          </p>
        ) : (
          <div style={{ display: "grid", gap: "18px" }}>
            {grouped.map(({ group, items }, index) => (
              <NoteGroup
                key={group?.id ?? "loose"}
                group={group}
                step={group ? String(index + 1).padStart(2, "0") : null}
                items={items}
                editable={editable}
                busy={busy}
                onToggle={toggleNote}
                onRemove={removeNote}
                onRemoveGroup={removeGroup}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ---------------- העברה ---------------- */}
      {isAdmin && (
        <Section title="העברה">
          <p style={{ margin: 0, fontSize: "12.5px", color: C.muted }}>
            {STAGES[project.stage]?.hint ?? ""}
            {project.assigned_to && team.find((u) => u.id === project.assigned_to)
              ? ` · אצל ${team.find((u) => u.id === project.assigned_to).name}`
              : ""}
          </p>

          <Field label="תדריך לאיש השיווק">
            <textarea
              value={project.brief ?? ""}
              onChange={(e) => queueSave(projectId, { brief: e.target.value })}
              placeholder="מה המערכת עושה, מי הקהל, מה להדגיש"
              rows={4}
              style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.55 }}
            />
          </Field>
          <button onClick={writeBrief} disabled={busy === "brief"} style={{ ...ghostButton, justifySelf: "start" }}>
            {busy === "brief" ? <Loader2 size={13} /> : <Send size={13} />} כתוב תדריך עם AI
          </button>

          <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            <HandoffButton
              label="שלח לשיווק"
              icon={<Megaphone size={14} />}
              people={marketers}
              disabled={busy === "handoff"}
              onSend={(userId) => handoff("marketing", userId)}
            />
            <HandoffButton
              label="שלח למתכנת"
              icon={<Send size={14} />}
              people={developers}
              disabled={busy === "handoff"}
              onSend={(userId) => handoff("dev", userId)}
            />
          </div>

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button onClick={() => handoff("done", null)} disabled={busy === "handoff"} style={ghostButton}>
              <Check size={13} /> סמן כהושלם
            </button>
            {project.stage !== "draft" && (
              <button
                onClick={() => handoff("draft", null)}
                disabled={busy === "handoff"}
                style={{ ...ghostButton, color: C.muted }}
              >
                <Undo2 size={13} /> החזר אליי בלבד
              </button>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

// בחירת אדם ושליחה באותה שורה. בלי אנשים בתפקיד המתאים הכפתור מסביר
// למה הוא כבוי במקום פשוט לא להגיב.
function HandoffButton({ label, icon, people, disabled, onSend }) {
  const [selected, setSelected] = useState("");

  if (people.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: "12px", color: C.muted }}>
        {label}: אין עדיין אף אחד בתפקיד הזה. הוסף אותו במסך «צוות והרשאות».
      </p>
    );
  }

  return (
    <div style={{ display: "flex", gap: "6px" }}>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        aria-label={label}
        style={{ ...input, flex: 1, minWidth: 0 }}
      >
        <option value="">בחר אדם…</option>
        {people.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => selected && onSend(selected)}
        disabled={disabled || !selected}
        style={{ ...primaryButton, padding: "8px 12px", fontSize: "12.5px" }}
      >
        {icon} {label}
      </button>
    </div>
  );
}
