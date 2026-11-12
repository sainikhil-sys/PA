import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINTENANCE_OPEN_PATHS, maintenanceOn, maintenanceResponse } from "@/lib/maintenance";

describe("maintenance mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless MAINTENANCE_MODE is exactly on", () => {
    vi.stubEnv("MAINTENANCE_MODE", "");
    expect(maintenanceOn()).toBe(false);
    vi.stubEnv("MAINTENANCE_MODE", "true");
    expect(maintenanceOn()).toBe(false);
    vi.stubEnv("MAINTENANCE_MODE", "on");
    expect(maintenanceOn()).toBe(true);
  });

  it("answers API calls with 503 and a code the app can recognise", async () => {
    const res = maintenanceResponse();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("300");
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("maintenance");
    expect(body.error).not.toMatch(/—/);
  });

  it("keeps the legal pages readable", () => {
    for (const p of ["/privacy", "/terms", "/delete-account", "/maintenance"]) expect(MAINTENANCE_OPEN_PATHS).toContain(p);
  });
});
