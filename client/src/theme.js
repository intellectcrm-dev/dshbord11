export const STATUS = {
  active: { label: "פעיל", color: "#2F5D8A" },
  paused: { label: "מוקפא", color: "#D98E04" },
  done: { label: "הושלם", color: "#4A7856" },
  blocked: { label: "תקוע", color: "#B44B3D" },
};

export const C = {
  bg: "#F7F5F0",
  surface: "#fff",
  ink: "#1E2019",
  muted: "#6b6b63",
  line: "#d8d5c9",
  lineSoft: "#ece9dd",
  accent: "#2F5D8A",
  danger: "#B44B3D",
};

export const input = {
  padding: "10px 12px",
  border: `1px solid ${C.line}`,
  background: "#fff",
  fontSize: "14px",
};

export const primaryButton = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "10px 16px",
  background: C.accent,
  color: "#fff",
  border: "none",
  cursor: "pointer",
  fontSize: "14px",
};
