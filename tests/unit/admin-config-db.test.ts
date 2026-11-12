import { describe, expect, it, vi } from "vitest";

/**
 * Store, rollback and release guard against a real throwaway Postgres with all migrations applied.
 * Runs only when COWORK_TEST_DATABASE_URL points at localhost; every test rolls its transaction back.
 *   COWORK_TEST_DATABASE_URL=postgres://postgres@localhost:54329/cwdev npx vitest run tests/unit/admin-config-db.test.ts
 */
const URL_ = process.env.COWORK_TEST_DATABASE_URL ?? "";
const enabled = /^postgres(ql)?:\/\/[^/]*@(localhost|127\.0\.0\.1)[:/]/.test(URL_);

vi.mock("server-only", () => ({}));

describe.skipIf(!enabled)("configuration store on Postgres", async () => {
  if (enabled) process.env.DATABASE_URL = URL_;
  const { eq } = await import("drizzle-orm");
  const { db, schema } = await import("@/lib/db");
  const store = await import("@/lib/config/store");
  const { configRollbackOp, configUpdateOp } = await import("@/lib/admin/ops/config");
  const { flagRestoreOp, flagUpdateOp } = await import("@/lib/admin/ops/flags");
  const { liveStoreBuilds, policyMandatoryOp, releaseStatusOp } = await import("@/lib/admin/ops/releases");
  type Ctx = Parameters<typeof configUpdateOp.run>[1];

  class Rollback extends Error {}

  /** Runs fn in a transaction with a fresh user and always rolls it back. */
  async function inTx(fn: (ctx: Ctx, records: unknown[]) => Promise<void>) {
    await db()
      .transaction(async (tx) => {
        const [user] = await tx
          .insert(schema.users)
          .values({ email: `cfg-${Date.now()}-${Math.random()}@example.com` })
          .returning();
        const records: unknown[] = [];
        const ctx = { user: user!, role: "owner", adminSession: {} as Ctx["adminSession"], userSessionId: "s", platform: "web", tx, record: (r: unknown) => records.push(r) } as Ctx;
        await fn(ctx, records);
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
  }

  it("writes versions and history, rejects unknown keys and rolls back as a new version", async () => {
    await inTx(async (ctx) => {
      const key = "uploads.maxMb";
      const base = (await store.readConfigRow(ctx.tx, key))?.version ?? 0;
      const v1 = await configUpdateOp.run({ key, value: 3, reason: "test one" }, ctx);
      const v2 = await configUpdateOp.run({ key, value: 2, reason: "test two" }, ctx);
      expect(v1.version).toBe(base + 1);
      expect(v2.version).toBe(base + 2);
      await expect(configUpdateOp.run({ key: "made.up", value: 1, reason: "nope" }, ctx)).rejects.toThrow(/doesn't exist/);
      await expect(configUpdateOp.run({ key, value: 99, reason: "too big" }, ctx)).rejects.toThrow();
      await expect(configUpdateOp.run({ key: "maintenance.active", value: true, reason: "not here" }, ctx)).rejects.toThrow(/own card/);

      const back = await configRollbackOp.run({ key, version: v1.version, reason: "restore" }, ctx);
      expect(back.version).toBe(base + 3);
      const row = await store.readConfigRow(ctx.tx, key);
      expect(row).toMatchObject({ value: 3, version: base + 3 });
      const hist = await ctx.tx.select().from(schema.appConfigurationHistory).where(eq(schema.appConfigurationHistory.key, key));
      const last = hist.find((h) => h.version === base + 3)!;
      expect(last).toMatchObject({ value: 3, previousValue: 2, restoredFromVersion: v1.version, reason: "restore" });
    });
  });

  it("flags: update and restore write new versions", async () => {
    await inTx(async (ctx) => {
      const state = { enabled: true, rolloutPercent: 10, targeting: {}, startsAt: null, endsAt: null, description: "" };
      const a = await flagUpdateOp.run({ key: "chat.attachments", state, reason: "start small" }, ctx);
      const b = await flagUpdateOp.run({ key: "chat.attachments", state: { ...state, rolloutPercent: 50 }, reason: "more" }, ctx);
      const c = await flagRestoreOp.run({ key: "chat.attachments", version: a.version, reason: "back" }, ctx);
      expect([b.version, c.version]).toEqual([a.version + 1, a.version + 2]);
      const [row] = await ctx.tx.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, "chat.attachments"));
      expect(row).toMatchObject({ rolloutPercent: 10, version: a.version + 2 });
    });
  });

  it("refuses a minimum build until a live store build has reported its version", async () => {
    await inTx(async (ctx) => {
      const policy = { minBuild: 2, latestVersion: "1.1.0", latestBuild: 2, mode: "optional" as const, message: null, storeUrl: null };
      await expect(policyMandatoryOp.run({ policy, reason: "force" }, ctx)).rejects.toThrow(/No live store build/);
      const [rel] = await ctx.tx.insert(schema.applicationReleases).values({ platform: "android", kind: "store", version: "9.9.9", buildNumber: 999_999, channel: "production", status: "draft" }).returning();
      await releaseStatusOp.run({ id: rel!.id, status: "live" }, ctx);
      expect((await liveStoreBuilds(ctx.tx)).find((b) => b.buildNumber === 999_999)?.sendsHeaders).toBe(false);
      const [sess] = await ctx.tx.insert(schema.sessions).values({ userId: ctx.user.id, tokenHash: `t-${Math.random()}`, expiresAt: new Date(Date.now() + 86_400_000), platform: "android", appBuild: 999_999 }).returning();
      expect(sess).toBeTruthy();
      expect((await liveStoreBuilds(ctx.tx)).find((b) => b.buildNumber === 999_999)?.sendsHeaders).toBe(true);
      const out = await policyMandatoryOp.run({ policy: { ...policy, minBuild: 999_999 }, reason: "force" }, ctx);
      expect(out.version).toBeGreaterThan(0);
    });
  });
});
