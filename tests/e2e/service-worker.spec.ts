import { expect, test, type Page } from "@playwright/test";

const CACHE_PREFIX = "sokomind-shell-";
const UPDATE_REVISION = "playwright-lifecycle";

async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
    )
    .not.toBeNull();
}

test("an online navigation 404 cannot poison the offline app shell", async ({
  context,
  page,
}) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Sokomind" })).toBeVisible();
  await waitForServiceWorkerControl(page);

  const missingResponse = await page.goto("./not-found");
  expect(missingResponse?.status()).toBe(404);
  await expect(page.locator("body")).toHaveText("Not found");

  const cachedShellStatus = await page.evaluate(async (cachePrefix) => {
    const cacheName = (await caches.keys()).find((name) =>
      name.startsWith(cachePrefix),
    );
    if (!cacheName) return null;
    const cache = await caches.open(cacheName);
    const shellUrl = new URL("./", document.baseURI).href;
    return (await cache.match(shellUrl))?.status ?? null;
  }, CACHE_PREFIX);
  expect(cachedShellStatus).toBe(200);

  await context.setOffline(true);
  try {
    const offlineResponse = await page.goto("./");
    expect(offlineResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Sokomind" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("a runtime dialog chunk fills on demand and reopens offline", async ({
  context,
  page,
}) => {
  await page.addInitScript(() => {
    const key = "sokomind-test-document-loads";
    const count = Number(sessionStorage.getItem(key) ?? "0") + 1;
    sessionStorage.setItem(key, String(count));
  });
  await page.goto("./#/play/ultra-tiny");
  await expect(page.getByRole("heading", { name: "First Steps" })).toBeVisible();
  await waitForServiceWorkerControl(page);
  expect(await page.evaluate(() =>
    sessionStorage.getItem("sokomind-test-document-loads"))).toBe("1");

  const state = await page.evaluate(async (cachePrefix) => {
    const cacheName = (await caches.keys()).find((name) =>
      name.startsWith(cachePrefix));
    if (!cacheName) return null;
    const cache = await caches.open(cacheName);
    const cachedUrls = (await cache.keys()).map((request) => request.url);
    const manifest = await fetch(new URL("./asset-manifest.json", document.baseURI))
      .then((response) => response.json()) as {
        precache: string[];
        runtime: string[];
      };
    return { cachedUrls, manifest };
  }, CACHE_PREFIX);

  expect(state).not.toBeNull();
  for (const lazyPattern of [
    /ProgressDialog-/,
    /SolverDialog-/,
    /solver\.worker-/,
    /sokomind-engine\.worker-/,
  ]) {
    const runtimeAsset = state?.manifest.runtime.find((entry) =>
      lazyPattern.test(entry));
    expect(runtimeAsset).toBeTruthy();
    expect(state?.cachedUrls).not.toContain(
      new URL(runtimeAsset ?? "", page.url()).href,
    );
  }

  const loadedPuzzleShard = state?.manifest.runtime.find((entry) =>
    /puzzle-shard-000-.*\.json$/u.test(entry));
  expect(loadedPuzzleShard).toBeTruthy();
  const loadedPuzzleShardUrl = new URL(
    loadedPuzzleShard ?? "",
    page.url(),
  ).href;
  await expect
    .poll(() =>
      page.evaluate(
        async ({ cachePrefix, assetUrl }) => {
          const cacheName = (await caches.keys()).find((name) =>
            name.startsWith(cachePrefix));
          if (!cacheName) return false;
          return Boolean(await caches.open(cacheName).then((cache) =>
            cache.match(assetUrl)));
        },
        { cachePrefix: CACHE_PREFIX, assetUrl: loadedPuzzleShardUrl },
      ),
    )
    .toBe(true);

  const progressAsset = state?.manifest.runtime.find((entry) =>
    /ProgressDialog-.*\.js$/u.test(entry));
  expect(progressAsset).toBeTruthy();
  const progressAssetUrl = new URL(progressAsset ?? "", page.url()).href;
  expect(state?.cachedUrls).not.toContain(progressAssetUrl);

  await page.getByRole("button", { name: "Open progress" }).click();
  const progressDialog = page.getByRole("dialog", { name: "Your progress" });
  await expect(progressDialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async ({ cachePrefix, assetUrl }) => {
          const cacheName = (await caches.keys()).find((name) =>
            name.startsWith(cachePrefix));
          if (!cacheName) return false;
          return Boolean(await caches.open(cacheName).then((cache) =>
            cache.match(assetUrl)));
        },
        { cachePrefix: CACHE_PREFIX, assetUrl: progressAssetUrl },
      ),
    )
    .toBe(true);
  await progressDialog.getByRole("button", { name: "Close" }).click();

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "First Steps" }),
    ).toBeVisible();
    expect(await page.evaluate(() =>
      sessionStorage.getItem("sokomind-test-document-loads"))).toBe("2");

    await page.getByRole("button", { name: "Open progress" }).click();
    await expect(
      page.getByRole("dialog", { name: "Your progress" }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("a revised worker replaces old caches and prunes unexpected entries", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Sokomind" })).toBeVisible();
  await waitForServiceWorkerControl(page);

  const initialGeneration = await page.evaluate(async (cachePrefix) => ({
    controllerUrl: navigator.serviceWorker.controller?.scriptURL ?? null,
    cacheNames: (await caches.keys())
      .filter((name) => name.startsWith(cachePrefix))
      .sort(),
  }), CACHE_PREFIX);
  expect(initialGeneration.controllerUrl).toMatch(/\/sw\.js$/u);
  expect(initialGeneration.cacheNames).toHaveLength(1);
  expect(initialGeneration.cacheNames).not.toContain(
    `${CACHE_PREFIX}${UPDATE_REVISION}`,
  );

  await page.goto("./manifest.webmanifest");
  await page.evaluate(
    async ({ cachePrefix, updateCacheName }) => {
      const obsoleteUrl = new URL("./obsolete-test-entry", document.baseURI);
      const oldCache = await caches.open(`${cachePrefix}obsolete`);
      await oldCache.put(obsoleteUrl, new Response("old"));
      const futureCache = await caches.open(updateCacheName);
      await futureCache.put(obsoleteUrl, new Response("unexpected"));
    },
    {
      cachePrefix: CACHE_PREFIX,
      updateCacheName: `${CACHE_PREFIX}${UPDATE_REVISION}`,
    },
  );

  await page.evaluate(async (revision) => {
    const workerUrl = new URL("./sw.js", document.baseURI);
    workerUrl.searchParams.set("playwright-sw-revision", revision);
    const registration = await navigator.serviceWorker.register(workerUrl, {
      scope: "./",
      updateViaCache: "none",
    });

    await new Promise<void>((resolve, reject) => {
      if (registration.waiting) {
        resolve();
        return;
      }
      const worker = registration.installing;
      if (!worker) {
        reject(new Error("The revised service worker did not start installing."));
        return;
      }
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") resolve();
        if (worker.state === "redundant") {
          reject(new Error("The revised service worker became redundant."));
        }
      });
    });

    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  }, UPDATE_REVISION);

  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ""),
    )
    .toContain(`playwright-sw-revision=${UPDATE_REVISION}`);

  const updatedControllerUrl = await page.evaluate(() =>
    navigator.serviceWorker.controller?.scriptURL ?? null);
  expect(updatedControllerUrl).not.toBe(initialGeneration.controllerUrl);

  await expect
    .poll(() =>
      page.evaluate(async (cachePrefix) =>
        (await caches.keys())
          .filter((name) => name.startsWith(cachePrefix))
          .sort(),
      CACHE_PREFIX),
    )
    .toEqual([`${CACHE_PREFIX}${UPDATE_REVISION}`]);

  const cacheState = await page.evaluate(async (cachePrefix) => {
    const matchingNames = (await caches.keys())
      .filter((name) => name.startsWith(cachePrefix))
      .sort();
    const activeName = matchingNames[0];
    if (!activeName) return { matchingNames, cachedUrls: [], expectedUrls: [] };

    const cache = await caches.open(activeName);
    const cachedUrls = (await cache.keys()).map((request) => request.url).sort();
    const manifestUrl = new URL("./asset-manifest.json", document.baseURI);
    const assetManifest = await fetch(manifestUrl).then((response) =>
      response.json()) as { precache: string[] };
    const expectedUrls = [
      "./",
      "./asset-manifest.json",
      "./favicon.svg",
      "./icon-192.png",
      "./icon-512.png",
      "./manifest.webmanifest",
      ...assetManifest.precache,
    ]
      .map((entry) => new URL(entry, document.baseURI).href)
      .sort();
    return { matchingNames, cachedUrls, expectedUrls };
  }, CACHE_PREFIX);

  expect(cacheState.matchingNames).toEqual([
    `${CACHE_PREFIX}${UPDATE_REVISION}`,
  ]);
  expect(cacheState.cachedUrls).toEqual(cacheState.expectedUrls);
});
