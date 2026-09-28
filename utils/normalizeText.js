// Keeps typed-in Operator names / Vehicle codes converging on one
// consistent form over time, so "sheila jones" and "Sheila  Jones" resolve
// to the same record instead of silently creating duplicates.
export const normalizeName = (raw) =>
  (raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

export const normalizeCode = (raw) => (raw || "").trim().replace(/\s+/g, "").toUpperCase();

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
