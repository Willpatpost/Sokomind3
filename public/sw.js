const CACHE_PREFIX = "sokomind-shell";
const CACHE_REVISION = "__SOKOMIND_BUILD_REVISION__";
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_REVISION}`;
const SCOPE_URL = new URL(self.registration.scope);
const APP_SHELL_URL = new URL("./", SCOPE_URL).href;
const ASSET_MANIFEST_URL = new URL("./asset-manifest.json", SCOPE_URL).href;
const SHELL_URLS = [
  "./",
  "./favicon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.webmanifest",
].map((path) => new URL(path, SCOPE_URL).href);

function scopedUrl(path) {
  const url = new URL(path, SCOPE_URL);
  if (
    url.origin !== SCOPE_URL.origin ||
    !url.pathname.startsWith(SCOPE_URL.pathname)
  ) {
    throw new Error(`Asset manifest entry is outside the app scope: ${path}`);
  }
  return url.href;
}

function parseAssetManifest(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.version !== 1 ||
    !Array.isArray(value.precache) ||
    !Array.isArray(value.runtime) ||
    [...value.precache, ...value.runtime].some(
      (entry) => typeof entry !== "string",
    )
  ) {
    throw new Error("Asset manifest must contain precache and runtime paths.");
  }

  const precache = value.precache.map(scopedUrl);
  const runtime = value.runtime.map(scopedUrl);
  const all = [...precache, ...runtime];
  if (new Set(all).size !== all.length) {
    throw new Error("Asset manifest paths must be unique.");
  }
  return { precache, runtime };
}

async function populateCurrentCache() {
  const manifestResponse = await fetch(ASSET_MANIFEST_URL, { cache: "no-store" });
  if (!manifestResponse.ok) {
    throw new Error(`Asset manifest request failed: ${manifestResponse.status}`);
  }

  const assetUrls = parseAssetManifest(await manifestResponse.clone().json());
  const cache = await caches.open(CACHE_NAME);
  try {
    await cache.put(ASSET_MANIFEST_URL, manifestResponse);
    const installUrls = [...new Set([...SHELL_URLS, ...assetUrls.precache])];
    await Promise.all(installUrls.map(async (url) => {
      // Mutable shell names must bypass the HTTP cache so a new cache revision
      // cannot combine stale HTML with the new build's hashed assets.
      const response = await fetch(new Request(url, { cache: "reload" }));
      if (!response.ok) {
        throw new Error(`Install resource request failed: ${response.status}`);
      }
      await cache.put(url, response);
    }));
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

async function expectedCacheUrls(cache) {
  const manifestResponse = await cache.match(ASSET_MANIFEST_URL);
  if (!manifestResponse) {
    throw new Error("The cached asset manifest is missing.");
  }

  const assetUrls = parseAssetManifest(await manifestResponse.json());
  return new Set([
    ASSET_MANIFEST_URL,
    ...SHELL_URLS,
    ...assetUrls.precache,
    ...assetUrls.runtime,
  ]);
}

async function pruneCurrentCache() {
  const cache = await caches.open(CACHE_NAME);
  const expectedUrls = await expectedCacheUrls(cache);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => !expectedUrls.has(request.url))
      .map((request) => cache.delete(request)),
  );
}

async function activateCurrentCache() {
  // Validate and prune the staged generation before removing the last known-good
  // cache. A corrupt installation must not discard the active offline shell.
  await pruneCurrentCache();
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter(
        (cacheName) =>
          cacheName.startsWith(`${CACHE_PREFIX}-`) && cacheName !== CACHE_NAME,
      )
      .map((cacheName) => caches.delete(cacheName)),
  );
  await self.clients.claim();
}

async function respondToNavigation(request) {
  try {
    // Navigation responses never replace the install-time app shell. In
    // particular, an online 404 must remain a 404 without poisoning offline use.
    return await fetch(request);
  } catch {
    return (await caches.open(CACHE_NAME).then((cache) => cache.match(APP_SHELL_URL))) ??
      Response.error();
  }
}

async function respondToAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (!response.ok || response.type !== "basic") return response;

  const expectedUrls = await expectedCacheUrls(cache);
  if (expectedUrls.has(request.url)) {
    // The response promise remains pending until this write completes, keeping
    // the fetch event alive instead of launching an untracked cache mutation.
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(populateCurrentCache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activateCurrentCache());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (
    url.origin !== SCOPE_URL.origin ||
    !url.pathname.startsWith(SCOPE_URL.pathname)
  ) {
    return;
  }

  event.respondWith(
    request.mode === "navigate"
      ? respondToNavigation(request)
      : respondToAsset(request),
  );
});
