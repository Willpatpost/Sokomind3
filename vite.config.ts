import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const DEFAULT_PUBLIC_SITE_URL =
  "https://willpatpost.github.io/Sokomind/";

function normalizeSiteUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function metadataPlugin(publicSiteUrl: string, isProd: boolean): Plugin {
  return {
    name: "sokomind-public-metadata",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const replaced = html.replaceAll("__PUBLIC_SITE_URL__", publicSiteUrl);
        if (!isProd) return replaced;

        // Compute SHA-256 hashes of inline scripts for CSP
        const inlineScriptHashes: string[] = [];
        const scriptRegex = /<script>([^]*?)<\/script>/g;
        let match;
        while ((match = scriptRegex.exec(replaced)) !== null) {
          const hash = crypto
            .createHash("sha256")
            .update(match[1])
            .digest("base64");
          inlineScriptHashes.push(`'sha256-${hash}'`);
        }

        const scriptSrc = ["'self'", ...inlineScriptHashes].join(" ");

        return {
          html: replaced,
          tags: [
            {
              tag: "meta",
              attrs: {
                "http-equiv": "Content-Security-Policy",
                content: [
                  "default-src 'self'",
                  `script-src ${scriptSrc}`,
                  "style-src 'self' 'unsafe-inline'",
                  "img-src 'self' data:",
                  "connect-src 'self'",
                  "worker-src 'self'",
                  "object-src 'none'",
                  "base-uri 'self'",
                  "form-action 'self'",
                ].join("; "),
              },
              injectTo: "head-prepend",
            },
          ],
        };
      },
    },
  };
}

function assetManifestPlugin(): Plugin {
  const serviceWorkerRevisionToken = "__SOKOMIND_BUILD_REVISION__";
  const revisionInputs = [
    "index.html",
    "favicon.svg",
    "icon-192.png",
    "icon-512.png",
    "manifest.webmanifest",
  ];
  const runtimeOnlyAssetPrefixes = [
    "ProgressDialog-",
    "SolverDialog-",
    "solver.worker-",
    "sokomind-engine.worker-",
    "puzzle-shard-",
  ];

  return {
    name: "sokomind-asset-manifest",
    apply: "build",
    async closeBundle() {
      const assetsDir = path.join("dist", "assets");
      const files = (await fs.readdir(assetsDir)).sort();
      const precache = files
        .filter((file) => !runtimeOnlyAssetPrefixes.some((prefix) =>
          file.startsWith(prefix)))
        .map((file) => `./assets/${file}`);
      const runtime = files
        .filter((file) => runtimeOnlyAssetPrefixes.some((prefix) =>
          file.startsWith(prefix)))
        .map((file) => `./assets/${file}`);
      const manifest = { version: 1, precache, runtime };
      const serializedManifest = JSON.stringify(manifest, null, 2);
      await fs.writeFile(
        path.join("dist", "asset-manifest.json"),
        serializedManifest,
      );

      const workerPath = path.join("dist", "sw.js");
      const workerTemplate = await fs.readFile(workerPath, "utf8");
      if (!workerTemplate.includes(serviceWorkerRevisionToken)) {
        throw new Error("Service worker revision token is missing from dist/sw.js.");
      }

      const revisionHash = crypto.createHash("sha256");
      revisionHash.update(serializedManifest);
      revisionHash.update(workerTemplate);
      for (const relativePath of revisionInputs) {
        revisionHash.update(relativePath);
        revisionHash.update(await fs.readFile(path.join("dist", relativePath)));
      }
      const revision = revisionHash.digest("hex").slice(0, 16);
      await fs.writeFile(
        workerPath,
        workerTemplate.replaceAll(serviceWorkerRevisionToken, revision),
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const publicSiteUrl = normalizeSiteUrl(
    environment.VITE_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL,
  );

  return {
    // Relative assets make one build portable across project pages, user pages,
    // custom domains, and local static-file servers.
    base: "./",
    plugins: [
      metadataPlugin(publicSiteUrl, mode === "production"),
      react(),
      assetManifestPlugin(),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL(".", import.meta.url)),
      },
    },
    build: {
      target: "es2022",
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes("node_modules/react/") ||
              id.includes("node_modules/react-dom/")
            ) {
              return "react-vendor";
            }
            if (id.includes("imported-puzzles.json")) {
              return "puzzle-catalog";
            }
          },
        },
      },
    },
  };
});
