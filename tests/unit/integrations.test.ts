import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/integrations/catalog";
import { escapeLittleText, linkedinVersion } from "@/lib/integrations/linkedin-format";

describe("integration catalog", () => {
  it("has no 'coming soon' entries: every tool has a real connect method", () => {
    for (const c of CATALOG) expect(["google", "token", "oauth", "none"]).toContain(c.connect);
  });
  it("token tools declare their credential fields or default to one token", () => {
    const zoom = CATALOG.find((c) => c.id === "zoom")!;
    expect(zoom.fields?.map((f) => f.name)).toEqual(["accountId", "clientId", "clientSecret"]);
    expect(CATALOG.find((c) => c.id === "stripe")!.tokenHelp).toMatch(/restricted/i);
  });
});

describe("LinkedIn formatting", () => {
  it("escapes little-text markup so posts read exactly as approved", () => {
    expect(escapeLittleText("Ship it (v2) #launch @team *now*")).toBe("Ship it \\(v2\\) \\#launch \\@team \\*now\\*");
    expect(escapeLittleText("plain text, no markup.")).toBe("plain text, no markup.");
  });
  it("picks an API version about three months back", () => {
    expect(linkedinVersion(new Date("2026-10-17T00:00:00Z"))).toBe("202607");
    expect(linkedinVersion(new Date("2026-02-01T00:00:00Z"))).toBe("202511");
  });
});
