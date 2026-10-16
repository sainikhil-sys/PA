import { expect, test, type Page } from "@playwright/test";

const EMAIL = "owner@example.com";
const TEST_CODE = "424242"; // OTP_TEST_MODE only

test.describe.configure({ mode: "serial" });

test("health and auth gates", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).database).toBe("ok");

  const mcp = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(mcp.status()).toBe(401);
  expect(mcp.headers()["www-authenticate"]).toContain("resource_metadata");

  const cron = await request.get("/api/cron/dispatch");
  expect(cron.status()).toBe(401);

  const meta = await request.get("/.well-known/oauth-authorization-server");
  expect((await meta.json()).code_challenge_methods_supported).toEqual(["S256"]);
});

test("unknown emails get the same generic response", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("stranger@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByRole("group", { name: "Verification code" }).getByLabel("Digit 1 of 6").fill(TEST_CODE);
  await expect(page.getByText("That code didn't work")).toBeVisible();
});

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  // Paste support: filling the first box with the whole code spreads it across the boxes.
  await page.getByLabel("Digit 1 of 6").fill(TEST_CODE);
}

test("OTP login → onboarding → dashboard → chat → task → automation dry run", async ({ page }) => {
  await signIn(page);

  // Onboarding (first login)
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.getByLabel("What should we call you?").fill("Sam Owner");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("radio", { name: /Warm/ }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();

  // Today dashboard
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByText(/Good (morning|afternoon|evening), Sam/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top priorities" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mail that needs you" })).toBeVisible();
  await expect(page.getByRole("region", { name: "World news" })).toBeVisible();

  // Chat: streaming answer from the mock model, with tool chips
  await page.goto("/chat");
  await page.getByLabel(/^Message/).fill("What tasks do I have?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Hello from the test model. Everything is working.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Used: Tasks/ })).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/);

  // Tasks: natural-language quick add
  await page.goto("/tasks");
  await page.getByLabel("Add a task").fill("call Ravi tomorrow at 5 #sales");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Task added")).toBeVisible();
  await expect(page.getByRole("button", { name: /call Ravi/ })).toBeVisible();
  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page.getByRole("region", { name: "To do" }).getByText("call Ravi")).toBeVisible();

  // Automations: create from template, then dry run (no side effects)
  await page.goto("/automations/new?template=overdue-nudge");
  await page.getByRole("button", { name: "Save automation" }).click();
  await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Dry run" }).first().click();
  await expect(page.getByText(/^Would: Ask the agent/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Would: Notify you/)).toBeVisible();

  // Command palette and chat panel shortcuts
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
});
