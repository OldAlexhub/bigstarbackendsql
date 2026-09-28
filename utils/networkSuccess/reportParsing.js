import XLSX from "xlsx";

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export const cellText = (value) => (value === null || value === undefined ? "" : String(value));

export const readFirstSheet = (buffer) => {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The workbook does not contain a worksheet.");
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });
};

export const readNamedSheet = (buffer, names, description) => {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: false });
  const accepted = new Set(names.map((name) => name.trim().toLowerCase()));
  const sheetName = workbook.SheetNames.find((name) => accepted.has(name.trim().toLowerCase()));
  if (!sheetName) {
    throw new Error(`The workbook does not contain the ${description} worksheet.`);
  }
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });
};

export const findRow = (grid, predicate) => grid.findIndex((row, index) => predicate(row || [], index));

export const findColumn = (row, patterns, description, { preferLast = false } = {}) => {
  for (const pattern of patterns) {
    const matches = [];
    (row || []).forEach((value, index) => {
      if (pattern.test(cellText(value).trim())) matches.push(index);
    });
    if (matches.length) return preferLast ? matches[matches.length - 1] : matches[0];
  }
  throw new Error(`Could not find the ${description} column.`);
};

export const numberValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(cellText(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export const percentageValue = (value) => {
  const parsed = numberValue(cellText(value).replace(/%/g, ""));
  if (parsed === null) return null;
  return parsed > 1 ? parsed / 100 : parsed;
};

export const dateValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(EXCEL_EPOCH_MS + Math.round(value) * 86400000).toISOString().slice(0, 10);
  }
  const text = cellText(value).trim();
  const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

export const isoDay = (value) => dateValue(value);

export const normalizePersonName = (value) =>
  cellText(value)
    .toUpperCase()
    .replace(/\b(JR|SR|II|III|IV)\.?\b/g, "")
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .sort()
    .join("");

export const splitRunAndOperator = (value) => {
  const text = cellText(value).trim();
  const comma = text.indexOf(",");
  if (comma < 0) return { route: text, operator: null };
  return {
    route: text.slice(0, comma).trim(),
    operator: text.slice(comma + 1).trim() || null,
  };
};

export const workbookDateRange = (grid) => {
  for (const row of grid) {
    for (const cell of row || []) {
      const match = cellText(cell).match(/(?:Date\s*range:|From:)\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:-|To:)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (match) return { from: dateValue(match[1]), to: dateValue(match[2]) };
    }
  }
  return { from: null, to: null };
};
