import { describe, expect, it } from "vitest";
import { callBackLink, classifyPhoneEvent, isPairCode, normalizePairCode, whatsappLink } from "@/lib/phone";

describe("phone link", () => {
  it("classifies calls, SMS, WhatsApp and other apps", () => {
    expect(classifyPhoneEvent("com.whatsapp", "msg")).toBe("whatsapp");
    expect(classifyPhoneEvent("com.whatsapp.w4b")).toBe("whatsapp");
    expect(classifyPhoneEvent("com.google.android.dialer")).toBe("call");
    expect(classifyPhoneEvent("com.truecaller", "call")).toBe("call");
    expect(classifyPhoneEvent("com.samsung.android.messaging", "msg")).toBe("sms");
    expect(classifyPhoneEvent("com.slack", "msg")).toBe("notification");
  });

  it("normalizes and validates pairing codes", () => {
    expect(normalizePairCode(" ab-c 23d ")).toBe("ABC23D");
    expect(isPairCode("ABC23D")).toBe(true);
    expect(isPairCode("ABC10D")).toBe(false); // 0/1 aren't in the alphabet
    expect(isPairCode("ABC2")).toBe(false);
  });

  it("builds WhatsApp and call-back links only from numbers", () => {
    expect(whatsappLink("+91 98765 43210")).toBe("https://wa.me/919876543210");
    expect(whatsappLink("Ravi")).toBe("https://wa.me/");
    expect(callBackLink("+91 (987) 654-3210")).toBe("tel:+919876543210");
    expect(callBackLink("Mom")).toBeNull();
  });
});
