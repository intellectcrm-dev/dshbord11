import { useEffect, useState } from "react";
import { ChevronLeft, FolderKanban, Lock, Shield, Users } from "lucide-react";
import { api } from "../api.js";
import { C } from "../theme.js";

export default function Login({ onLoggedIn, notice }) {
  const [mode, setMode] = useState("choose"); // choose | admin | member
  const [members, setMembers] = useState([]);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.members().then(setMembers).catch(() => setMembers([]));
  }, []);

  function back() {
    setMode("choose");
    setError("");
    setPassword("");
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = mode === "admin" ? await api.adminLogin(password) : await api.memberLogin(userId, password);
      onLoggedIn(user);
    } catch (err) {
      setError(err.message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "380px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "28px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              background: C.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FolderKanban size={18} color={C.bg} />
          </div>
          <div>
            <div style={{ fontFamily: "'Rubik', sans-serif", fontWeight: 700, fontSize: "18px", lineHeight: 1.1 }}>
              לוח פרויקטים
            </div>
            <div style={{ fontSize: "12px", color: C.muted }}>ניהול גישה ועבודה</div>
          </div>
        </div>

        {notice && !error && (
          <div style={{ fontSize: "13px", color: C.muted, marginBottom: "14px" }}>{notice}</div>
        )}

        {mode === "choose" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <button
              onClick={() => setMode("admin")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "16px",
                background: C.ink,
                color: C.bg,
                border: "none",
                cursor: "pointer",
                fontSize: "15px",
              }}
            >
              <Shield size={18} /> כניסת מנהל
            </button>
            <button
              onClick={() => setMode("member")}
              disabled={members.length === 0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "16px",
                background: "transparent",
                color: C.ink,
                border: `1px solid ${C.ink}`,
                cursor: "pointer",
                fontSize: "15px",
              }}
            >
              <Users size={18} /> כניסת איש צוות
            </button>
            {members.length === 0 && (
              <div style={{ fontSize: "12px", color: C.muted, marginTop: "4px" }}>
                עדיין לא הוגדרו אנשי צוות. המנהל יכול להוסיף אותם אחרי הכניסה.
              </div>
            )}
          </div>
        )}

        {mode !== "choose" && (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button
              type="button"
              onClick={back}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "none",
                border: "none",
                color: C.muted,
                cursor: "pointer",
                fontSize: "13px",
                padding: 0,
                alignSelf: "flex-start",
              }}
            >
              <ChevronLeft size={14} style={{ transform: "rotate(180deg)" }} /> חזרה
            </button>

            {mode === "member" && (
              <>
                <label htmlFor="member" style={{ fontSize: "13px" }}>
                  שם
                </label>
                <select
                  id="member"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  required
                  style={{ padding: "12px", border: `1px solid ${C.line}`, background: "#fff", fontSize: "15px" }}
                >
                  <option value="">בחר שם</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label htmlFor="password" style={{ fontSize: "13px" }}>
              {mode === "admin" ? "סיסמת מנהל" : "סיסמה"}
            </label>
            <div style={{ position: "relative" }}>
              <Lock
                size={16}
                style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", color: C.muted }}
              />
              <input
                id="password"
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="הזן סיסמה"
                style={{
                  width: "100%",
                  padding: "12px 40px 12px 12px",
                  border: `1px solid ${C.line}`,
                  background: "#fff",
                  fontSize: "15px",
                }}
              />
            </div>

            {error && <div style={{ color: C.danger, fontSize: "13px" }}>{error}</div>}

            <button
              type="submit"
              disabled={busy}
              style={{ padding: "12px", background: C.accent, color: "#fff", border: "none", cursor: "pointer", fontSize: "15px" }}
            >
              {busy ? "מתחבר..." : "כניסה"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
