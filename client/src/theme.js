// עיצוב «סטודיו»: מסך כהה בניגודיות גבוהה, ענבר כצבע ההדגשה היחיד.
// כל צבע במערכת יוצא מכאן, כך שהחלפת פלטה היא שינוי בקובץ אחד.

export const STATUS = {
  active: { label: "פעיל", color: "#5FBF8A" },
  paused: { label: "מוקפא", color: "#E3A44B" },
  done: { label: "הושלם", color: "#7FB2E5" },
  blocked: { label: "תקוע", color: "#E0685A" },
};

export const C = {
  bg: "#12141A",
  surface: "#1B1E26",
  surfaceAlt: "#222630",
  ink: "#EDEFF3",
  inkSoft: "#C3CAD6",
  muted: "#8C94A3",
  line: "#2B303B",
  lineSoft: "#232833",
  accent: "#E3A44B",
  accentInk: "#1A1206",
  danger: "#E0685A",
  radius: "9px",
};

export const input = {
  padding: "9px 11px",
  border: `1px solid ${C.line}`,
  background: C.surfaceAlt,
  color: C.ink,
  fontSize: "14px",
  borderRadius: "7px",
  fontFamily: "inherit",
  outlineColor: C.accent,
};

export const primaryButton = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "9px 16px",
  background: C.accent,
  color: C.accentInk,
  border: "none",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 700,
  borderRadius: "7px",
  fontFamily: "inherit",
};

// כפתור משני: אותה צורה, בלי למשוך את העין מהפעולה הראשית.
export const ghostButton = {
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  padding: "6px 11px",
  background: "transparent",
  color: C.accent,
  border: `1px solid ${C.line}`,
  cursor: "pointer",
  fontSize: "12.5px",
  borderRadius: "7px",
  fontFamily: "inherit",
};
