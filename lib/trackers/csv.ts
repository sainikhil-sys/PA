/**
 * CSV writing (pure, unit-tested). RFC 4180 quoting plus a guard against
 * spreadsheet formula injection: a cell starting with = + - @ (or a tab or
 * carriage return) is prefixed with a single quote so Excel and Sheets show it as text.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (typeof value === "string" && FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Rows to CSV text with CRLF line endings. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
