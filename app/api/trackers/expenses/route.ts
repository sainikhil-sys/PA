import { apiGuard } from "@/lib/auth/api";
import { errorJson } from "@/lib/security/request";
import { toCsv } from "@/lib/trackers/csv";
import { MONTH_RE } from "@/lib/trackers/dates";
import { categoryLabel, fromMinor } from "@/lib/trackers/money";
import { listMonthExpenses } from "@/lib/trackers/queries";

export const dynamic = "force-dynamic";

/** CSV of one month's expenses: GET /api/trackers/expenses?month=YYYY-MM */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) return errorJson(400, "invalid_month");

  const rows = await listMonthExpenses(g.user.id, month);
  const csv = toCsv(
    ["Date", "Amount", "Currency", "Category", "Merchant", "Note"],
    rows
      .slice()
      .reverse()
      .map((r) => [r.spentOn, fromMinor(r.amountMinor, r.currency), r.currency, categoryLabel(r.category), r.merchant, r.note]),
  );
  // BOM so Excel reads UTF-8 (currency symbols, non-Latin merchant names).
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expenses-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
