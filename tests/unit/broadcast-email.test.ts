import { describe, expect, it } from "vitest";
import type { BroadcastEmailContent } from "@/lib/db/schema";
import { classifyUpload, cidFor, formatBytes, imageSize, MAX_ATTACHMENT_BYTES, MAX_INLINE_BYTES, sanitizeFilename } from "@/lib/email/attachments";
import {
  cleanEmail,
  draftToEmail,
  inlineHtml,
  inlineText,
  linkAllowList,
  noDashes,
  plainNotificationText,
  renderBroadcastEmail,
  restrictLinks,
  safeMailUrl,
} from "@/lib/email/broadcast";

const BASE = "https://app.example.com";
const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p)));

describe("safeMailUrl", () => {
  it("accepts web links, mail links and app paths", () => {
    expect(safeMailUrl("https://example.com/a?b=1", BASE)).toBe("https://example.com/a?b=1");
    expect(safeMailUrl("http://example.com", BASE)).toBe("http://example.com/");
    expect(safeMailUrl("mailto:team@example.com", BASE)).toBe("mailto:team@example.com");
    expect(safeMailUrl("/settings/notifications", BASE)).toBe(`${BASE}/settings/notifications`);
  });
  it("rejects script, data, protocol-relative, credential and hidden links", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "//evil.com", "/\\evil.com", "https://user:pw@example.com", "https://localhost/x", "mailto:nobody", "ftp://example.com", "/console", "/console/users", ""]) {
      expect(safeMailUrl(bad, BASE), bad).toBeNull();
    }
  });
});

describe("inline markdown", () => {
  it("escapes everything and only allows bold and safe links", () => {
    expect(inlineHtml("<script>x</script> **hi**", BASE)).toBe('&lt;script&gt;x&lt;/script&gt; <strong style="font-weight:600">hi</strong>');
    expect(inlineHtml('[Docs](https://example.com/?a="b")', BASE)).toContain('href="https://example.com/?a=%22b%22"');
    expect(inlineHtml("[Bad](javascript:alert(1))", BASE)).toBe("Bad)");
    expect(inlineHtml("[Open](/tasks)", BASE)).toContain(`href="${BASE}/tasks"`);
  });
  it("writes links as label (url) in plain text", () => {
    expect(inlineText("See [the guide](https://example.com/g) **now**", BASE)).toBe("See the guide (https://example.com/g) now");
  });
});

describe("renderBroadcastEmail", () => {
  const content: BroadcastEmailContent = {
    subject: "What's new",
    preheader: "Three updates",
    headline: "New <things>",
    blocks: [
      { type: "text", text: "Hello **there**.\n\nSecond paragraph" },
      { type: "image", fileId: "f1", alt: 'A "chart"', href: "/tasks" },
      { type: "list", items: ["One", "", "Two"] },
      { type: "button", label: "Open", url: "/chat" },
      { type: "button", label: "Bad", url: "javascript:void(0)" },
      { type: "divider" },
    ],
  };
  const mail = renderBroadcastEmail(content, {
    appBase: BASE,
    imageSrc: (id) => (id === "f1" ? `cid:${cidFor(id)}` : null),
    images: new Map([["f1", { width: 1200, height: 600 }]]),
    attachments: [{ filename: "guide.pdf", size: 2048 }],
    manageUrl: `${BASE}/settings/notifications`,
    unsubscribeUrl: `${BASE}/u/x`,
  });

  it("renders escaped content, cid images at card width and real buttons only", () => {
    expect(mail.subject).toBe("What's new");
    expect(mail.html).toContain("New &lt;things&gt;");
    expect(mail.html).toContain('src="cid:img-f1"');
    expect(mail.html).toContain('width="464"');
    expect(mail.html).toContain('alt="A &quot;chart&quot;"');
    expect(mail.html).toContain(`href="${BASE}/chat"`);
    expect(mail.html).not.toContain("javascript:");
    expect(mail.html).toContain("guide.pdf");
    expect(mail.html).toContain("Unsubscribe from updates");
    expect(mail.html.match(/&#8226;/g)).toHaveLength(2);
  });
  it("has a plain-text part with links, attachments and the unsubscribe link", () => {
    expect(mail.text).toContain(`Open: ${BASE}/chat`);
    expect(mail.text).not.toContain("Bad:");
    expect(mail.text).toContain("Attached: guide.pdf");
    expect(mail.text).toContain(`Unsubscribe from updates: ${BASE}/u/x`);
    expect(mail.text).toContain("[Image: A \"chart\"]");
  });
});

describe("AI drafts", () => {
  const note = "We launched the phone link. Download it at https://example.com/app.";
  const email = draftToEmail({
    subject: "Phone link",
    preheader: "",
    headline: "Your phone, in Cowork",
    intro: "Get it [here](https://example.com/app) or read [this](https://made-up.example/x). Also https://made-up.example/y",
    sections: [{ heading: "Pairing", text: "Pair in [Phone](/phone) or [Secret](/console).", bullets: ["Fast", " "] }],
    cta: { label: "Learn more", url: "https://invented.example" },
    closing: "Thanks",
  });
  const safe = restrictLinks(email.blocks, linkAllowList(note));

  it("keeps links from the note and app pages, removes invented ones", () => {
    const text = JSON.stringify(safe);
    expect(text).toContain("[here](https://example.com/app)");
    expect(text).toContain("[Phone](/phone)");
    expect(text).not.toContain("made-up.example");
    expect(text).not.toContain("/console");
    expect(safe.some((b) => b.type === "button")).toBe(false);
  });
  it("turns sections into editable blocks", () => {
    expect(email.blocks.map((b) => b.type)).toEqual(["text", "heading", "text", "list", "button", "text"]);
  });
  it("cleans and clamps before sending", () => {
    const c = cleanEmail({ subject: "  Hi  ", preheader: "", headline: "x".repeat(500), blocks: [{ type: "text", text: "  " }, { type: "list", items: ["", "a"] }, { type: "image", fileId: "f", alt: " ", href: " " }] });
    expect(c.subject).toBe("Hi");
    expect(c.headline).toHaveLength(150);
    expect(c.blocks).toEqual([
      { type: "list", items: ["a"] },
      { type: "image", fileId: "f", alt: "" },
    ]);
  });
  it("removes em dashes from AI copy but keeps number ranges", () => {
    expect(noDashes("Fast — and private")).toBe("Fast, and private");
    expect(noDashes("Ready—set")).toBe("Ready, set");
    expect(noDashes("Calm – plain notes")).toBe("Calm, plain notes");
    expect(noDashes("Pages 1–5 load")).toBe("Pages 1–5 load");
    expect(noDashes("Done — .")).toBe("Done.");
  });
  it("keeps notifications free of links and markdown", () => {
    expect(plainNotificationText("Try **it** at [the app](https://example.com) https://x.example now")).toBe("Try it at the app now");
  });
});

describe("attachments", () => {
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR", [0, 0, 2, 128, 0, 0, 1, 224], [0, 0, 0, 0]);
  const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], new Array(14).fill(0), [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03], new Array(8).fill(0));
  const gif = bytes("GIF89a", [32, 0, 16, 0], [0, 0, 0]);
  const webpX = bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0], [0, 0, 0, 0], [0x7f, 0x02, 0x00], [0xdf, 0x01, 0x00]);
  const pdf = bytes("%PDF-1.7\n%stuff");
  const docx = bytes([0x50, 0x4b, 0x03, 0x04], "....[Content_Types].xml....word/document.xml....");

  it("reads image sizes from headers", () => {
    expect(imageSize(png)).toEqual({ width: 640, height: 480 });
    expect(imageSize(jpeg)).toEqual({ width: 400, height: 300 });
    expect(imageSize(gif)).toEqual({ width: 32, height: 16 });
    expect(imageSize(webpX)).toEqual({ width: 640, height: 480 });
    expect(imageSize(pdf)).toBeNull();
  });
  it("accepts files whose bytes match their type", () => {
    expect(classifyUpload("photo.PNG", png, "inline")).toMatchObject({ ok: true, filename: "photo.png", contentType: "image/png", width: 640 });
    expect(classifyUpload("guide.pdf", pdf, "attachment")).toMatchObject({ ok: true, contentType: "application/pdf", kind: "doc" });
    expect(classifyUpload("plan.docx", docx, "attachment")).toMatchObject({ ok: true, kind: "doc" });
    expect(classifyUpload("notes.csv", bytes("a,b\n1,2\n"), "attachment")).toMatchObject({ ok: true, contentType: "text/csv" });
    expect(classifyUpload("invite.ics", bytes("BEGIN:VCALENDAR\nEND:VCALENDAR\n"), "attachment")).toMatchObject({ ok: true });
  });
  it("rejects disguised, risky or oversized files", () => {
    const bad: [string, Uint8Array, "inline" | "attachment"][] = [
      ["fake.pdf", bytes("MZ this is an exe"), "attachment"],
      ["tool.exe", bytes("MZ"), "attachment"],
      ["logo.svg", bytes("<svg onload=alert(1)>"), "inline"],
      ["guide.pdf", pdf, "inline"],
      ["macro.docx", bytes([0x50, 0x4b, 0x03, 0x04], "word/document.xml vbaProject.bin"), "attachment"],
      ["data.csv", bytes("a,b", [0], "c"), "attachment"],
      ["cal.ics", bytes("hello"), "attachment"],
      ["empty.txt", new Uint8Array(), "attachment"],
      ["big.png", Uint8Array.from({ length: MAX_INLINE_BYTES + 1 }, (_, i) => png[i] ?? 0), "inline"],
    ];
    for (const [name, b, role] of bad) expect(classifyUpload(name, b, role).ok, name).toBe(false);
    expect(MAX_ATTACHMENT_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
  it("sanitizes file names", () => {
    expect(sanitizeFilename("C:\\Users\\me\\Report Q3.PDF")).toBe("Report Q3.pdf");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("invoice\u202Efdp.exe")).toBe("invoicefdp.exe");
    expect(sanitizeFilename('a<b>:"c|?*.txt')).toBe("abc.txt");
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename(`${"x".repeat(300)}.pdf`)).toHaveLength(104);
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
