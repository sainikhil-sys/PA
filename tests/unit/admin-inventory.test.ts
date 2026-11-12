import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fails if an admin route or action is added without going through the shared checks.
 * Routes under app/api/admin must use adminRoute(...) (the op pipeline) or, for the few that can't be
 * JSON ops, adminRequest/adminRequestWith. Every export of app/actions/admin.ts must run an op.
 */
const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const routes = walk(path.join(ROOT, "app/api/admin")).filter((f) => /route\.tsx?$/.test(f));
/** Routes allowed to use the lower-level guard, and why. */
const LOW_LEVEL = new Map([
  ["me", "must answer while the console is locked"],
  ["step-up", "creates the admin session"],
  ["lock", "ends the admin session"],
  ["broadcast-files", "multipart upload, not JSON"],
]);

describe("admin route inventory", () => {
  it("finds the admin routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of routes) {
    const rel = path.relative(path.join(ROOT, "app/api/admin"), file).replace(/\\/g, "/");
    it(`${rel} goes through the admin checks`, () => {
      const src = fs.readFileSync(file, "utf8");
      const top = rel.split("/")[0]!;
      const handlers = [...src.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      expect(handlers.length).toBeGreaterThan(0);
      if (LOW_LEVEL.has(top)) {
        expect(src).toMatch(/adminRequest(With)?\(req/);
      } else {
        for (const h of handlers) expect(src).toMatch(new RegExp(`export const ${h} = adminRoute\\(`));
      }
      // Never the generic owner guard alone.
      expect(src).not.toMatch(/apiGuard\(/);
    });
  }
});

/** admin-auth.ts is the exception: it creates the admin session the ops require. */
const actionFiles = fs.readdirSync(path.join(ROOT, "app/actions")).filter((f) => /^admin(-[\w-]+)?\.ts$/.test(f) && f !== "admin-auth.ts");

describe.each(actionFiles)("admin server actions in %s", (file) => {
  const src = fs.readFileSync(path.join(ROOT, "app/actions", file), "utf8");
  const exported = [...src.matchAll(/export (?:const|async function) (\w+)/g)].map((m) => m[1]!);

  it("every console action runs an op through adminAction", () => {
    expect(exported.length).toBeGreaterThan(0);
    for (const name of exported) {
      const direct = new RegExp(`export const ${name} = adminAction\\(`).test(src);
      const wrapped = new RegExp(`export async function ${name}\\([^)]*\\) \\{\\n\\s+const r = await \\w+\\(`).test(src.replace(/\r\n/g, "\n"));
      expect(direct || wrapped, `${name} must call an adminAction`).toBe(true);
    }
    expect(src).not.toMatch(/ownerAction\(/);
  });
});
