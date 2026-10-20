import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/trackers/csv";
import { addDays, currentStreak, isValidIsoDate, monthRange, shiftMonth, todayIn, weekStart } from "@/lib/trackers/dates";
import { formatMoney, fractionDigits, fromMinor, guessCategory, MAX_AMOUNT_MINOR, toMinor, totalsByCurrency } from "@/lib/trackers/money";
import { parseExpenseLine } from "@/lib/trackers/quick-add";

const TZ = "Asia/Kolkata";
// Tuesday 2026-10-20 10:00 IST
const NOW = new Date("2026-10-20T04:30:00Z");
const opts = { timezone: TZ, defaultCurrency: "INR", now: NOW };

function parse(s: string) {
  const r = parseExpenseLine(s, opts);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe("expense quick add", () => {
  it("reads a bare amount and guesses the category", () => {
    expect(parse("120 coffee")).toEqual({ amountMinor: 12000, currency: "INR", category: "food", merchant: "", note: "coffee", spentOn: "2026-10-20" });
  });

  it("reads decimals, a merchant after 'at' and yesterday", () => {
    expect(parse("450.50 groceries at DMart yesterday")).toEqual({
      amountMinor: 45050,
      currency: "INR",
      category: "groceries",
      merchant: "DMart",
      note: "groceries",
      spentOn: "2026-10-19",
    });
  });

  it("uses currency symbols and codes over the default", () => {
    expect(parse("$12.5 lunch at Subway")).toMatchObject({ amountMinor: 1250, currency: "USD", merchant: "Subway", category: "food" });
    expect(parse("1,200 usd flight")).toMatchObject({ amountMinor: 120000, currency: "USD", category: "travel" });
    expect(parse("¥1500 ramen")).toMatchObject({ amountMinor: 1500, currency: "JPY" });
    expect(parse("rs 80 auto")).toMatchObject({ amountMinor: 8000, currency: "INR", category: "transport" });
  });

  it("resolves weekdays to the most recent one, in the user's timezone", () => {
    expect(parse("300 movie friday").spentOn).toBe("2026-10-16");
    expect(parse("300 movie tuesday").spentOn).toBe("2026-10-20");
    expect(parse("300 movie last tuesday").spentOn).toBe("2026-10-13");
    // 20:00 UTC on the 19th is already the 20th in India.
    const late = parseExpenseLine("50 tea today", { ...opts, now: new Date("2026-10-19T20:00:00Z") });
    expect(late.ok && late.value.spentOn).toBe("2026-10-20");
    const utc = parseExpenseLine("50 tea today", { ...opts, timezone: "UTC", now: new Date("2026-10-19T20:00:00Z") });
    expect(utc.ok && utc.value.spentOn).toBe("2026-10-19");
  });

  it("merchant stops before a trailing date and the merchant feeds the category", () => {
    expect(parse("230 at Starbucks on monday")).toMatchObject({ merchant: "Starbucks", note: "", category: "food", spentOn: "2026-10-19" });
  });

  it("rejects lines without a valid amount", () => {
    expect(parseExpenseLine("coffee", opts).ok).toBe(false);
    expect(parseExpenseLine("0 coffee", opts).ok).toBe(false);
    expect(parseExpenseLine("12.345 coffee", opts).ok).toBe(false);
    expect(parseExpenseLine("¥12.5 sushi", opts).ok).toBe(false);
    expect(parseExpenseLine("99999999999 car", opts).ok).toBe(false);
  });
});

describe("money", () => {
  it("knows each currency's minor digits", () => {
    expect(fractionDigits("INR")).toBe(2);
    expect(fractionDigits("USD")).toBe(2);
    expect(fractionDigits("JPY")).toBe(0);
  });

  it("formats INR, USD and JPY with their own digits", () => {
    expect(formatMoney(12345050, "INR")).toBe("₹1,23,450.50");
    expect(formatMoney(123450, "USD")).toBe("$1,234.50");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
  });

  it("converts to and from minor units without floating point drift", () => {
    expect(toMinor("0.29", "USD")).toBe(29);
    expect(toMinor("450.5", "INR")).toBe(45050);
    expect(toMinor("1,200", "JPY")).toBe(1200);
    expect(toMinor("1.50", "JPY")).toBeNull();
    expect(toMinor("-5", "USD")).toBeNull();
    expect(toMinor("abc", "USD")).toBeNull();
    expect(toMinor(String(MAX_AMOUNT_MINOR / 100 + 1), "USD")).toBeNull();
    expect(fromMinor(45050, "INR")).toBe("450.50");
    expect(fromMinor(5, "USD")).toBe("0.05");
    expect(fromMinor(1500, "JPY")).toBe("1500");
  });

  it("never adds different currencies together", () => {
    expect(
      totalsByCurrency([
        { amountMinor: 100, currency: "USD" },
        { amountMinor: 5000, currency: "INR" },
        { amountMinor: 250, currency: "USD" },
      ]),
    ).toEqual([
      { currency: "INR", minor: 5000 },
      { currency: "USD", minor: 350 },
    ]);
  });

  it("guesses categories from keywords", () => {
    expect(guessCategory("uber to office")).toBe("transport");
    expect(guessCategory("rent october")).toBe("bills");
    expect(guessCategory("something odd")).toBe("other");
  });
});

describe("dates and streaks", () => {
  it("handles month and week math", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-03-01" });
    expect(weekStart("2026-10-20")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-02-28")).toBe(true);
  });

  it("counts consecutive days ending today, or yesterday if today has nothing yet", () => {
    const days = ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-15"];
    expect(currentStreak(days, "2026-10-19")).toBe(3);
    expect(currentStreak(days, "2026-10-20")).toBe(3);
    expect(currentStreak(days, "2026-10-21")).toBe(0);
    expect(currentStreak([], "2026-10-20")).toBe(0);
  });

  it("uses the user's timezone for today", () => {
    const days = ["2026-10-19", "2026-10-20"];
    const at = new Date("2026-10-19T20:00:00Z"); // 01:30 on the 20th in India, still the 19th in New York
    expect(currentStreak(days, todayIn("Asia/Kolkata", at))).toBe(2);
    expect(todayIn("America/New_York", at)).toBe("2026-10-19");
    expect(currentStreak(days, todayIn("America/New_York", at))).toBe(1);
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // US DST day
  });
});

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvCell("+91 phone")).toBe("'+91 phone");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it("builds rows with CRLF endings", () => {
    expect(toCsv(["a", "b"], [["1", "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});
