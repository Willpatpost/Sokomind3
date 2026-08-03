import { expect, test, type Page } from "@playwright/test";

async function solveOnePushWonder(page: Page) {
  for (const key of ["ArrowUp", "ArrowLeft", "ArrowUp", "ArrowRight"]) {
    await page.keyboard.press(key);
  }
  await expect(
    page.getByRole("dialog", { name: "One Push Wonder" }),
  ).toBeVisible();
}

test("malformed route segments recover to the home page", async ({ page }) => {
  await page.goto("./#/play/%E0%A4%A");

  await expect(page.getByRole("heading", { name: "Sokomind" })).toBeVisible();
  await expect(page).toHaveTitle("Sokomind");
});

test("error recovery reloads safely and confirms exact-key data reset", async ({
  page,
}) => {
  await page.goto("./#/play/ultra-tiny");
  await expect(page.getByRole("heading", { name: "First Steps" })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("sokomind.progress.v1", "owned-progress");
    localStorage.setItem("sokomind.optimal.v1", "owned-legacy");
    localStorage.setItem("sokomind-push-bounds-v1", "another-project");
    localStorage.setItem("unrelated", "keep");
    sessionStorage.setItem("sokomind:timer:ultra-tiny", "1234");
    sessionStorage.setItem("sokomind:timer-adjacent", "keep");
  });

  // WebKit retains failed module loads for the Page lifetime. Fail a lazy route
  // other than Home so recovery can return to the known-good entry screen.
  await page.route("**/assets/PuzzleSelectorPage-*.js", (route) =>
    route.abort(),
  );
  await page.goto("./#/puzzles");
  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Reload Sokomind" }).click();
  await page.waitForURL(/[?&]_r=/);
  await expect(page.getByRole("heading", { name: "Sokomind" })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("sokomind.progress.v1")),
  ).toBe("owned-progress");

  await page.goto("./#/puzzles");
  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
  ).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("This cannot be undone");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Reset saved data" }).click();
  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("sokomind.progress.v1")),
  ).toBe("owned-progress");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset saved data" }).click();
  await expect(page.getByRole("heading", { name: "Sokomind" })).toBeVisible({
    timeout: 15_000,
  });

  const stored = await page.evaluate(() => {
    const rawProgress = localStorage.getItem("sokomind.progress.v1");
    return {
      progress: rawProgress ? JSON.parse(rawProgress) as unknown : null,
      legacy: localStorage.getItem("sokomind.optimal.v1"),
      otherProject: localStorage.getItem("sokomind-push-bounds-v1"),
      unrelated: localStorage.getItem("unrelated"),
      timer: sessionStorage.getItem("sokomind:timer:ultra-tiny"),
      adjacentTimer: sessionStorage.getItem("sokomind:timer-adjacent"),
    };
  });
  expect(stored.progress).toMatchObject({
    version: 2,
    generation: 1,
    revision: 0,
    completed: {},
  });
  expect(stored).toMatchObject({
    legacy: null,
    otherProject: "another-project",
    unrelated: "keep",
    timer: null,
    adjacentTimer: "keep",
  });
});

test("error recovery reset cannot be resurrected by another active tab", async ({
  context,
}) => {
  const resetTab = await context.newPage();
  const staleTab = await context.newPage();
  await resetTab.goto("./#/play/ultra-tiny");
  await resetTab.evaluate(() => {
    localStorage.setItem("sokomind.progress.v1", JSON.stringify({
      version: 2,
      generation: 3,
      revision: 8,
      writerId: "seed",
      completed: {
        "ultra-tiny": {
          moves: 1,
          pushes: 1,
          completedAt: "2026-08-01T00:00:00.000Z",
        },
      },
    }));
  });
  await Promise.all([
    resetTab.reload(),
    staleTab.goto("./#/play/tutorial-push"),
  ]);
  await expect(
    staleTab.getByRole("heading", { name: "One Push Wonder" }),
  ).toBeVisible();
  await staleTab.evaluate(() => {
    sessionStorage.setItem("sokomind:timer:tutorial-push", "9876");
  });

  await resetTab.route("**/assets/PuzzleSelectorPage-*.js", (route) =>
    route.abort(),
  );
  await resetTab.goto("./#/puzzles");
  await expect(
    resetTab.getByRole("heading", { name: "Something went wrong" }),
  ).toBeVisible();
  resetTab.once("dialog", (dialog) => dialog.accept());
  await resetTab.getByRole("button", { name: "Reset saved data" }).click();
  await expect(
    resetTab.getByRole("heading", { name: "Sokomind" }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(
    staleTab.getByRole("heading", { name: "Sokomind" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(await staleTab.evaluate(() =>
    sessionStorage.getItem("sokomind:timer:tutorial-push"))).toBeNull();
  await staleTab.goto("./#/play/tutorial-push");
  await staleTab.getByRole("button", { name: "Open progress" }).click();
  const progressDialog = staleTab.getByRole("dialog", { name: "Your progress" });
  await expect(progressDialog.getByTestId("completed-count")).toHaveText("0");
  await progressDialog.getByRole("button", { name: "Close" }).click();
  await solveOnePushWonder(staleTab);

  await expect.poll(() => resetTab.evaluate(() => {
    const raw = localStorage.getItem("sokomind.progress.v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { completed?: Record<string, unknown> };
    return Object.keys(parsed.completed ?? {}).sort();
  })).toEqual(["tutorial-push"]);
});
