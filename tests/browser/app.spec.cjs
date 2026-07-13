const { test, expect } = require("@playwright/test");

test("published app opens and its non-audio controls respond", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page).toHaveTitle("Bass Trinity Trainer");
  await expect(page.locator("h1")).toHaveText("Bass Trinity Trainer");
  await expect(page.locator("#boards svg")).toHaveCount(4);

  await page.locator("#simpleModeBtn").click();
  await expect(page.locator("#simpleModeBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveClass(/simple-mode/);

  await page.locator("#helpBtn").click();
  await expect(page.locator("#helpModal")).toHaveClass(/show/);
  await page.locator("#closeHelpBtn").click();
  await expect(page.locator("#helpModal")).not.toHaveClass(/show/);

  await page.locator("#simpleModeBtn").click();
  await expect(page.locator("#simpleModeBtn")).toHaveAttribute("aria-pressed", "false");

  await page.locator("#historyBtnLive").click();
  await expect(page.locator("#historyModal")).toHaveClass(/show/);
  await expect(page.locator("#historyContent")).toContainText("まだ履歴がありません");

  expect(pageErrors).toEqual([]);
});
