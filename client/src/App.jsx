import { useCallback, useEffect, useState } from "react";
import { FolderKanban, LogOut } from "lucide-react";
import { api } from "./api.js";
import { C } from "./theme.js";
import Login from "./components/Login.jsx";
import ProjectsView from "./components/ProjectsView.jsx";
import TeamView from "./components/TeamView.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("projects");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setSession(user))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  // Any 401 coming back from the API means the session expired or was revoked
  // server-side — drop straight back to the login screen.
  const handleError = useCallback((err) => {
    if (err?.status === 401) {
      setSession(null);
      setError("פג תוקף החיבור. יש להתחבר מחדש.");
      return;
    }
    setError(err?.message || "שגיאה בלתי צפויה");
  }, []);

  async function logout() {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setView("projects");
      setError("");
    }
  }

  if (loading) {
    return <Centered>טוען...</Centered>;
  }

  if (!session) {
    return (
      <Login
        notice={error}
        onLoggedIn={(user) => {
          setSession(user);
          setError("");
        }}
      />
    );
  }

  const isAdmin = session.role === "admin";

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          borderBottom: `1px solid ${C.line}`,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              background: C.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FolderKanban size={16} color={C.bg} />
          </div>
          <div>
            <div style={{ fontFamily: "'Rubik', sans-serif", fontWeight: 700, fontSize: "16px", lineHeight: 1.1 }}>
              לוח פרויקטים
            </div>
            <div style={{ fontSize: "12px", color: C.muted }}>
              {isAdmin ? "מחובר כמנהל" : `שלום, ${session.name}`}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {isAdmin && (
            <div style={{ display: "flex", border: `1px solid ${C.line}` }}>
              <TabButton active={view === "projects"} onClick={() => setView("projects")}>
                פרויקטים
              </TabButton>
              <TabButton active={view === "team"} onClick={() => setView("team")} divider>
                צוות והרשאות
              </TabButton>
            </div>
          )}
          <button
            onClick={logout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 12px",
              background: "transparent",
              border: `1px solid ${C.line}`,
              cursor: "pointer",
              fontSize: "13px",
              color: C.muted,
            }}
          >
            <LogOut size={14} /> יציאה
          </button>
        </div>
      </header>

      <main style={{ padding: "20px", maxWidth: "900px", margin: "0 auto" }}>
        {error && (
          <div
            role="alert"
            style={{
              marginBottom: "16px",
              padding: "10px 12px",
              border: `1px solid ${C.danger}`,
              color: C.danger,
              background: "#fdf3f1",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
              gap: "10px",
            }}
          >
            <span>{error}</span>
            <button
              onClick={() => setError("")}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.danger }}
            >
              ✕
            </button>
          </div>
        )}

        {isAdmin && view === "team" ? (
          <TeamView onError={handleError} />
        ) : (
          <ProjectsView session={session} onError={handleError} />
        )}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, divider, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        background: active ? C.ink : "transparent",
        color: active ? C.bg : C.ink,
        border: "none",
        borderRight: divider ? `1px solid ${C.line}` : "none",
        cursor: "pointer",
        fontSize: "13px",
      }}
    >
      {children}
    </button>
  );
}

function Centered({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: C.ink,
      }}
    >
      {children}
    </div>
  );
}
