import { describe, expect, it } from "vitest";
import { canSignIn } from "@/lib/auth/otp-core";
import { BRAND } from "@/lib/brand";
import { appLink, digestEmail, notificationEmail, otpEmail, welcomeEmail } from "@/lib/email/templates";
import { unsubscribeUrl, verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

const SECRET = "x".repeat(40);
const UID = "123e4567-e89b-12d3-a456-426614174000";

describe("email templates", () => {
  it("brands the OTP email and shows the code", () => {
    const m = otpEmail("123456");
    expect(m.subject).toBe(`123456 is your ${BRAND.name} sign-in code`);
    expect(m.html).toContain("123456");
    expect(m.html).toContain(BRAND.name);
    expect(m.text).toContain("123456");
    expect(m.html).not.toMatch(/\bPA\b/);
  });

  it("escapes untrusted titles and bodies", () => {
    const m = notificationEmail({ kind: "urgent_email", title: `<img src=x onerror=alert(1)>`, body: `"quoted" & <b>`, url: "https://a.test/inbox", manageUrl: "https://a.test/s", unsubscribeUrl: "https://a.test/u" });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(m.html).toContain("&quot;quoted&quot; &amp; &lt;b&gt;");
    expect(m.html).toContain("Unsubscribe from updates");
  });

  it("only links to same-site paths", () => {
    expect(appLink("https://a.test", "/inbox")).toBe("https://a.test/inbox");
    expect(appLink("https://a.test", "//evil.test/x")).toBe("https://a.test");
    expect(appLink("https://a.test", "https://evil.test")).toBe("https://a.test");
    expect(appLink("https://a.test", null)).toBe("https://a.test");
  });

  it("renders welcome and digest emails", () => {
    expect(welcomeEmail({ appUrl: "https://a.test", manageUrl: "https://a.test/s" }).subject).toBe(`Welcome to ${BRAND.name}`);
    const d = digestEmail({
      date: "2026-10-17",
      b: { headline: "Busy day", summary: "Three meetings.", priorities: ["Ship <it>"], meetings: [{ start: "2026-10-17T09:30:00", title: "Standup" }] },
      appUrl: "https://a.test",
      manageUrl: "https://a.test/s",
      unsubscribeUrl: "https://a.test/u",
    });
    expect(d.html).toContain("Ship &lt;it&gt;");
    expect(d.html).toContain("09:30");
    expect(d.text).toContain("Stop daily briefings");
  });
});

describe("unsubscribe tokens", () => {
  it("round-trips and rejects tampering", () => {
    const url = new URL(unsubscribeUrl("https://a.test", UID, "digest", SECRET));
    const t = url.searchParams.get("t")!;
    expect(verifyUnsubscribeToken(UID, "digest", t, SECRET)).toBe(true);
    expect(verifyUnsubscribeToken(UID, "updates", t, SECRET)).toBe(false);
    expect(verifyUnsubscribeToken(UID, "digest", t, "y".repeat(40))).toBe(false);
    expect(verifyUnsubscribeToken("not-a-uuid", "digest", t, SECRET)).toBe(false);
    expect(verifyUnsubscribeToken(UID, "everything", t, SECRET)).toBe(false);
  });
});

describe("sign-in policy", () => {
  it("allowlist mode only admits listed emails", () => {
    expect(canSignIn("Me@Example.com", { open: false, allowed: ["me@example.com"] })).toBe(true);
    expect(canSignIn("other@example.com", { open: false, allowed: ["me@example.com"] })).toBe(false);
  });
  it("open mode admits any well-formed address", () => {
    expect(canSignIn("anyone@example.com", { open: true, allowed: [] })).toBe(true);
    expect(canSignIn("not-an-email", { open: true, allowed: [] })).toBe(false);
  });
});
