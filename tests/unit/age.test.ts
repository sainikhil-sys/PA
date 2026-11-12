import { describe, expect, it } from "vitest";
import { ageGroup, ageOn, checkBirthDate, parseBirthDate, todayIn } from "@/lib/safety/age";

describe("age rules", () => {
  it("counts completed years, birthday included", () => {
    expect(ageOn("2013-11-12", "2026-11-12")).toBe(13);
    expect(ageOn("2013-11-13", "2026-11-12")).toBe(12);
    expect(ageOn("2008-11-12", "2026-11-12")).toBe(18);
    expect(ageOn("2008-11-13", "2026-11-12")).toBe(17);
  });

  it("handles 29 February birthdays", () => {
    expect(ageOn("2012-02-29", "2025-02-28")).toBe(12);
    expect(ageOn("2012-02-29", "2025-03-01")).toBe(13);
  });

  it("rejects dates that don't exist or aren't ISO", () => {
    expect(parseBirthDate("2026-02-30")).toBeNull();
    expect(parseBirthDate("12/11/2010")).toBeNull();
    expect(checkBirthDate("2010-13-01", "2026-11-12")).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses under-13s, future dates and implausible ages", () => {
    expect(checkBirthDate("2014-01-01", "2026-11-12")).toEqual({ ok: false, reason: "under_age" });
    expect(checkBirthDate("2027-01-01", "2026-11-12")).toEqual({ ok: false, reason: "future" });
    expect(checkBirthDate("1890-01-01", "2026-11-12")).toEqual({ ok: false, reason: "implausible" });
  });

  it("groups 13 to 17 as teens and 18+ as adults", () => {
    expect(checkBirthDate("2012-06-01", "2026-11-12")).toEqual({ ok: true, group: "teen" });
    expect(checkBirthDate("1990-06-01", "2026-11-12")).toEqual({ ok: true, group: "adult" });
    expect(ageGroup(null, "2026-11-12")).toBeNull();
    expect(ageGroup("2008-11-13", "2026-11-12")).toBe("teen");
  });

  it("reads today's date in the person's time zone", () => {
    const now = new Date("2026-11-12T20:00:00Z");
    expect(todayIn("Asia/Kolkata", now)).toBe("2026-11-13");
    expect(todayIn("America/New_York", now)).toBe("2026-11-12");
    expect(todayIn("Not/AZone", now)).toBe("2026-11-12");
  });
});
