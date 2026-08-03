import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const buildDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
const expectedPublicSiteUrl = new URL(
  process.env.VITE_PUBLIC_SITE_URL || "https://willpatpost.github.io/Sokomind/",
);
expectedPublicSiteUrl.hash = "";
expectedPublicSiteUrl.search = "";
if (!expectedPublicSiteUrl.pathname.endsWith("/")) {
  expectedPublicSiteUrl.pathname += "/";
}

async function readBuildFile(relativePath) {
  return readFile(path.join(buildDirectory, relativePath), "utf8");
}

async function javascriptDependencyClosure(entryPattern) {
  const assetNames = (await readdir(path.join(buildDirectory, "assets")))
    .filter((name) => name.endsWith(".js"));
  const entry = assetNames.find((name) => entryPattern.test(name));
  assert.ok(entry, `expected an entry chunk matching ${entryPattern}`);

  const closure = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || closure.has(name)) continue;
    closure.add(name);
    const source = await readBuildFile(`assets/${name}`);
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(\s*)["']\.\/([^"']+\.js)["']/gu,
    )) {
      if (assetNames.includes(match[1])) pending.push(match[1]);
    }
  }
  return closure;
}

const DELIVERY_BUDGETS = Object.freeze({
  allScriptsAndStylesGzipBytes: 300_000,
  largestAssetGzipBytes: 70_000,
  homeRouteGzipBytes: 160_000,
  playRouteGzipBytes: 185_000,
  solverWorkerGzipBytes: 30_000,
  engineWorkerGzipBytes: 60_000,
  puzzleShardGzipBytes: 4_000,
});

function assertWithinBudget(label, actual, maximum) {
  assert.ok(
    actual <= maximum,
    `${label}: ${actual.toLocaleString()} gzip bytes exceeds ${maximum.toLocaleString()}`,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("builds a complete static GitHub Pages entry point", async () => {
  const html = await readBuildFile("index.html");

  assert.match(html, /<html lang="en">/i);
  assert.match(
    html,
    /<title>Sokomind \u2014 Thoughtful box puzzles<\/title>/i,
  );
  assert.match(html, /<div id="root"><\/div>/i);
  assert.doesNotMatch(
    html,
    /\b(?:src|href)=["']\/(?!\/)/i,
    "root-relative assets would break on a GitHub project page",
  );
  assert.doesNotMatch(html, /__PUBLIC_SITE_URL__/);
  assert.doesNotMatch(
    html,
    /frame-ancestors/i,
    "meta CSP must not claim unsupported framing protection",
  );
  assert.match(
    html,
    new RegExp(
      `rel="canonical" href="${escapeRegExp(expectedPublicSiteUrl.href)}"`,
    ),
  );
  assert.match(
    html,
    new RegExp(
      `property="og:url" content="${escapeRegExp(expectedPublicSiteUrl.href)}"`,
    ),
  );
  assert.match(
    html,
    new RegExp(
      `property="og:image"\\s+content="${escapeRegExp(new URL("og.png", expectedPublicSiteUrl).href)}"`,
    ),
  );
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);

  await Promise.all([
    access(path.join(buildDirectory, ".nojekyll")),
    access(path.join(buildDirectory, "favicon.svg")),
    access(path.join(buildDirectory, "og.png")),
    access(path.join(buildDirectory, "manifest.webmanifest")),
    access(path.join(buildDirectory, "sw.js")),
    access(path.join(buildDirectory, "icon-192.png")),
    access(path.join(buildDirectory, "icon-512.png")),
  ]);
});

test("asset manifest lists all hashed build assets", async () => {
  const manifest = JSON.parse(await readBuildFile("asset-manifest.json"));

  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.precache));
  assert.ok(Array.isArray(manifest.runtime));
  const entries = [...manifest.precache, ...manifest.runtime];
  assert.ok(manifest.precache.length > 0, "precache manifest should not be empty");
  assert.ok(manifest.runtime.length > 0, "runtime manifest should not be empty");
  assert.equal(new Set(entries).size, entries.length, "asset paths must be unique");

  for (const entry of entries) {
    assert.ok(
      entry.startsWith("./assets/"),
      `manifest entry should be a relative assets path: ${entry}`,
    );
    const target = path.join(buildDirectory, entry);
    assert.equal(
      (await stat(target)).isFile(),
      true,
      `manifest references missing file: ${entry}`,
    );
  }

  const emittedAssets = (await readdir(path.join(buildDirectory, "assets")))
    .map((name) => `./assets/${name}`)
    .sort();
  assert.deepEqual([...entries].sort(), emittedAssets);
  for (const lazyPattern of [
    /ProgressDialog-/,
    /SolverDialog-/,
    /solver\.worker-/,
    /sokomind-engine\.worker-/,
    /puzzle-shard-/,
  ]) {
    assert.equal(
      manifest.precache.some((entry) => lazyPattern.test(entry)),
      false,
      `${lazyPattern} must remain runtime-loaded`,
    );
    assert.equal(
      manifest.runtime.some((entry) => lazyPattern.test(entry)),
      true,
      `${lazyPattern} should be declared as a runtime asset`,
    );
  }
  assert.ok(
    manifest.runtime.filter((entry) => /puzzle-shard-/u.test(entry)).length > 1,
    "board data should be split across multiple runtime-loaded shards",
  );
});

test("production output is installable and omits public source maps", async () => {
  const manifest = JSON.parse(await readBuildFile("manifest.webmanifest"));
  const worker = await readBuildFile("sw.js");
  const assets = await readdir(path.join(buildDirectory, "assets"));

  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ["192x192", "512x512"],
  );
  assert.match(worker, /sokomind-shell/);
  assert.doesNotMatch(worker, /__SOKOMIND_BUILD_REVISION__/);
  assert.match(worker, /const CACHE_REVISION = "[a-f0-9]{16}";/);
  assert.equal(
    assets.some((asset) => asset.endsWith(".map")),
    false,
    "production source maps should not be publicly deployed",
  );
  assert.equal(
    assets.some((asset) => /^solver\.worker-[\w-]+\.js$/.test(asset)),
    true,
    "the solver must be emitted as a standalone module worker",
  );
});

test("all local scripts and styles referenced by index.html are deployable", async () => {
  const html = await readBuildFile("index.html");
  const assetReferences = [
    ...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi),
  ]
    .map((match) => match[1])
    .filter((reference) => !/^(?:[a-z]+:|\/\/|#)/i.test(reference));

  assert.ok(assetReferences.length > 0, "the entry point should load local assets");

  for (const reference of assetReferences) {
    const pathname = reference.split(/[?#]/, 1)[0];
    const target = path.resolve(buildDirectory, pathname);
    const relativeTarget = path.relative(buildDirectory, target);

    assert.ok(
      relativeTarget !== ".." && !relativeTarget.startsWith(`..${path.sep}`),
      `asset escapes the build directory: ${reference}`,
    );
    assert.equal((await stat(target)).isFile(), true, `missing asset: ${reference}`);
  }
});

test("the client bundle contains the playable application", async () => {
  const assets = await readdir(path.join(buildDirectory, "assets"));
  const jsFiles = assets.filter((f) => f.endsWith(".js"));
  assert.ok(jsFiles.length > 0, "should have JS assets");

  const allCode = (
    await Promise.all(
      jsFiles.map((f) => readBuildFile(`assets/${f}`)),
    )
  ).join("\n");

  assert.match(allCode, /First Steps/);
  assert.match(allCode, /Current route/);
  assert.match(allCode, /Move up/);
  assert.match(allCode, /Sokomind/);
  assert.doesNotMatch(allCode, /dist\/server|Cloudflare|wrangler/i);
});

test("the Home route does not load full puzzle-board data", async () => {
  const homeClosure = await javascriptDependencyClosure(/^HomePage-/u);
  assert.equal(
    [...homeClosure].some((name) => /^puzzle-catalog-/u.test(name)),
    false,
    `Home dependency closure unexpectedly includes ${[
      ...homeClosure,
    ].filter((name) => /^puzzle-catalog-/u.test(name)).join(", ")}`,
  );
});

test("production delivery stays within reviewed gzip budgets", async () => {
  const assetDirectory = path.join(buildDirectory, "assets");
  const assetNames = (await readdir(assetDirectory)).filter((name) =>
    /\.(?:css|js)$/u.test(name),
  );
  const assets = await Promise.all(
    assetNames.map(async (name) => {
      const bytes = await readFile(path.join(assetDirectory, name));
      return { name, gzipBytes: gzipSync(bytes).byteLength };
    }),
  );
  const puzzleShards = await Promise.all(
    (await readdir(assetDirectory))
      .filter((name) => /^puzzle-shard-.*\.json$/u.test(name))
      .map(async (name) => ({
        name,
        gzipBytes: gzipSync(await readFile(path.join(assetDirectory, name))).byteLength,
      })),
  );

  const totalGzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  const largest = assets.reduce((current, asset) =>
    asset.gzipBytes > current.gzipBytes ? asset : current,
  );
  assertWithinBudget(
    "all production scripts and styles",
    totalGzipBytes,
    DELIVERY_BUDGETS.allScriptsAndStylesGzipBytes,
  );
  assert.ok(puzzleShards.length > 1, "expected multiple puzzle board shards");
  const largestPuzzleShard = puzzleShards.reduce((current, shard) =>
    shard.gzipBytes > current.gzipBytes ? shard : current,
  );
  assertWithinBudget(
    `largest puzzle board shard (${largestPuzzleShard.name})`,
    largestPuzzleShard.gzipBytes,
    DELIVERY_BUDGETS.puzzleShardGzipBytes,
  );
  assertWithinBudget(
    `largest production asset (${largest.name})`,
    largest.gzipBytes,
    DELIVERY_BUDGETS.largestAssetGzipBytes,
  );

  function routeGzipBytes(patterns) {
    return assets
      .filter((asset) => patterns.some((pattern) => pattern.test(asset.name)))
      .reduce((sum, asset) => sum + asset.gzipBytes, 0);
  }

  const sharedRoutePatterns = [
    /^index-/u,
    /^react-vendor-/u,
    /^HowToPlay-/u,
    /^compute-stats-/u,
    /^navigation-/u,
    /^optimal-cache-/u,
    /^progress-/u,
    /^puzzles-/u,
  ];
  assertWithinBudget(
    "cold Home route",
    routeGzipBytes([...sharedRoutePatterns, /^HomePage-/u]),
    DELIVERY_BUDGETS.homeRouteGzipBytes,
  );
  assertWithinBudget(
    "cold Play route without closed dialogs",
    routeGzipBytes([
      ...sharedRoutePatterns,
      /^puzzle-shard-/u,
      /^PlayPage-/u,
      /^ConfirmDialog-/u,
      /^Modal-/u,
      /^solver-/u,
    ]),
    DELIVERY_BUDGETS.playRouteGzipBytes,
  );

  const solverWorker = assets.find((asset) => /^solver\.worker-/u.test(asset.name));
  const engineWorker = assets.find((asset) =>
    /^sokomind-engine\.worker-/u.test(asset.name),
  );
  assert.ok(solverWorker, "expected an emitted solver worker");
  assert.ok(engineWorker, "expected an emitted engine worker");
  assertWithinBudget(
    "outer solver worker",
    solverWorker.gzipBytes,
    DELIVERY_BUDGETS.solverWorkerGzipBytes,
  );
  assertWithinBudget(
    "nested engine worker",
    engineWorker.gzipBytes,
    DELIVERY_BUDGETS.engineWorkerGzipBytes,
  );
});
