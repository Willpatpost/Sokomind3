import { expect, test, type Page } from "@playwright/test";

async function solveFirstSteps(page: Page) {
  await expect(page.getByRole("heading", { name: "First Steps" })).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "First Steps" });
  await expect(async () => {
    await page.keyboard.press("ArrowDown");
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

async function solveOnePushWonder(page: Page) {
  await expect(
    page.getByRole("heading", { name: "One Push Wonder" }),
  ).toBeVisible();
  for (const key of ["ArrowUp", "ArrowLeft", "ArrowUp", "ArrowRight"]) {
    await page.keyboard.press(key);
  }
  const dialog = page.getByRole("dialog", { name: "One Push Wonder" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function storedProgressIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const serialized = localStorage.getItem("sokomind.progress.v1");
    if (!serialized) return [];
    const value = JSON.parse(serialized) as { completed?: Record<string, unknown> };
    return Object.keys(value.completed ?? {}).sort();
  });
}

test("home and puzzle selector follow progress updates from another tab", async ({
  context,
}) => {
  const homeTab = await context.newPage();
  const selectorTab = await context.newPage();
  const writerTab = await context.newPage();
  await Promise.all([
    homeTab.goto("./"),
    selectorTab.goto("./#/puzzles"),
    writerTab.goto("./#/play/ultra-tiny"),
  ]);

  const tutorialCard = selectorTab.getByRole("button", { name: /^Tutorial/ });
  await expect(homeTab.getByText(/^0 of \d+ rooms cleared$/)).toBeVisible();
  await expect(tutorialCard).toContainText(/0 of \d+ cleared/);

  await writerTab.evaluate(() => {
    localStorage.setItem("sokomind.progress.v1", JSON.stringify({
      version: 2,
      generation: 0,
      revision: 1,
      writerId: "cross-tab-test",
      completed: {
        "ultra-tiny": {
          moves: 1,
          pushes: 1,
          completedAt: "2026-08-01T00:00:00.000Z",
        },
      },
    }));
  });
  await expect(homeTab.getByText(/^1 of \d+ rooms cleared$/)).toBeVisible();
  await expect(tutorialCard).toContainText(/1 of \d+ cleared/);

  await writerTab.evaluate(() => {
    localStorage.setItem("sokomind.progress.v1", JSON.stringify({
      version: 2,
      generation: 1,
      revision: 0,
      writerId: "cross-tab-reset-test",
      completed: {},
    }));
  });
  await expect(homeTab.getByText(/^0 of \d+ rooms cleared$/)).toBeVisible();
  await expect(tutorialCard).toContainText(/0 of \d+ cleared/);
});

test("two active tabs preserve independent puzzle completions", async ({
  context,
}) => {
  const firstTab = await context.newPage();
  const secondTab = await context.newPage();
  await Promise.all([
    firstTab.goto("./#/play/ultra-tiny"),
    secondTab.goto("./#/play/tutorial-push"),
  ]);
  await Promise.all([
    expect(firstTab.getByRole("heading", { name: "First Steps" })).toBeVisible(),
    expect(secondTab.getByRole("heading", { name: "One Push Wonder" })).toBeVisible(),
  ]);

  const firstCompletion = await solveFirstSteps(firstTab);
  await solveOnePushWonder(secondTab);

  await expect.poll(() => storedProgressIds(firstTab)).toEqual([
    "tutorial-push",
    "ultra-tiny",
  ]);

  await firstCompletion.getByRole("button", { name: "Study board" }).click();
  await firstTab.getByRole("button", { name: "Open progress" }).click();
  const progressDialog = firstTab.getByRole("dialog", { name: "Your progress" });
  await expect(
    progressDialog.getByLabel("Import progress backup file"),
  ).toHaveAttribute("type", "file");
  await expect(progressDialog.getByTestId("completed-count")).toHaveText("2");
});

test("a reset propagates to another tab and stale progress is not resurrected", async ({
  context,
}) => {
  const resetTab = await context.newPage();
  const staleTab = await context.newPage();
  await Promise.all([
    resetTab.goto("./#/play/ultra-tiny"),
    staleTab.goto("./#/play/tutorial-push"),
  ]);

  const completion = await solveFirstSteps(resetTab);
  await completion.getByRole("button", { name: "Study board" }).click();
  await resetTab.getByRole("button", { name: "Open progress" }).click();
  const resetDialog = resetTab.getByRole("dialog", { name: "Your progress" });
  await resetDialog.getByRole("button", { name: "Reset saved progress" }).click();
  await resetDialog.getByRole("button", { name: "Yes, reset progress" }).click();
  await expect(resetDialog.getByTestId("completed-count")).toHaveText("0");

  await staleTab.getByRole("button", { name: "Open progress" }).click();
  const staleDialog = staleTab.getByRole("dialog", { name: "Your progress" });
  await expect(staleDialog.getByTestId("completed-count")).toHaveText("0");
  await staleDialog.getByRole("button", { name: "Close" }).click();

  await solveOnePushWonder(staleTab);
  await expect.poll(() => storedProgressIds(resetTab)).toEqual([
    "tutorial-push",
  ]);
});

test("a quota failure shows one warning and a later successful retry clears it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    const state = { blockProgress: true };
    Object.defineProperty(window, "__persistenceTestState", { value: state });
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === "sokomind.progress.v1" && state.blockProgress) {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });
  await page.goto("./#/play/ultra-tiny");

  let completion = await solveFirstSteps(page);
  const warning = page.getByTestId("persistence-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toHaveCount(1);

  await completion.getByRole("button", { name: "Study board" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  completion = await solveFirstSteps(page);
  await expect(warning).toHaveCount(1);

  await page.evaluate(() => {
    const testWindow = window as unknown as Window & {
      __persistenceTestState: { blockProgress: boolean };
    };
    testWindow.__persistenceTestState.blockProgress = false;
  });
  await completion.getByRole("button", { name: "Study board" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await solveFirstSteps(page);

  await expect(warning).toBeHidden();
  await expect.poll(() => storedProgressIds(page)).toEqual(["ultra-tiny"]);
});
