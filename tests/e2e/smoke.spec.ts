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

  // Draft preview of the automation in the Live Link panel (dashed, not saved)
  await page.getByRole("button", { name: "Preview in panel" }).click();
  await expect(page.getByText(/Draft preview \(dashed\)/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Command palette and chat panel shortcuts
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Live Link panel: shortcut, opacity, dock, live run, click-through, list view", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

  // Open with Cmd/Ctrl+Shift+L
  await page.keyboard.press("Control+Shift+L");
  const panel = page.getByRole("dialog", { name: "Live links panel" });
  await expect(panel).toBeVisible();

  // Change opacity
  await panel.getByRole("button", { name: "Opacity" }).click();
  const slider = panel.getByLabel(/Opacity/).and(page.locator("input[type=range]"));
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(panel.getByText(/^(5|6)\d%$/)).toBeVisible();
  await panel.getByRole("button", { name: "Opacity" }).click();

  // Dock right: page content is pushed, not covered
  await panel.getByRole("button", { name: "Dock right" }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--lp-right").trim())).toBe("380px");

  // List view (keyboard-accessible alternative to the map)
  await panel.getByRole("button", { name: "List view" }).click();
  await expect(panel.getByRole("list", { name: "Nodes and links" })).toBeVisible();

  // Send a chat message without leaving the panel (client-side navigation)
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Chat" }).click();
  await page.getByLabel(/^Message/).fill("What tasks do I have?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Hello from the test model. Everything is working.")).toBeVisible({ timeout: 20_000 });

  // Links light up and a feed line appears
  await expect(panel.getByText(/Agent \(active\)/).first()).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText(/^Now:/)).toContainText(/Agent ·/);
  await expect(page.getByRole("button", { name: "Show in panel" }).first()).toBeVisible();

  // Click-through makes the panel non-interactive (except its own toggle)
  await panel.getByRole("button", { name: "Click-through" }).click();
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  await panel.getByRole("button", { name: "Click-through" }).click();
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).pointerEvents)).not.toBe("none");

  // Esc closes
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});
