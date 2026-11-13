/** Minor units to a readable amount, e.g. 4650000 USD to "46,500.00 USD". */
export function formatMinor(minor: number, currency: string): string {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown code: two decimals.
  }
  return `${(minor / 10 ** digits).toLocaleString("en", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
}
