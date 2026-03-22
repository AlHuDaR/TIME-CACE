const fs = require("fs/promises");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const STATIC_ASSET_PATHS = Object.freeze([
  "index.html",
  "official-time.html",
  "official-digital-time.html",
  "api-client.js",
  "status-monitor.js",
  "fallback-card.js",
  "runtime-sync.js",
  "dashboard-render.js",
  "ui-controls.js",
  "main.js",
  "official-time.js",
  "official-digital-time.js",
  "analog-clock.js",
  "styles.css",
  "styles",
  "images",
]);

const REDIRECTS = `\
/ /official-time.html 301!
/official-time /official-time.html 200
/official-digital-time /official-digital-time.html 200
/dashboard /index.html 200
`;

const HEADERS = `\
/*
  Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
  Pragma: no-cache
  Expires: 0
  Surrogate-Control: no-store
`;

async function ensureCleanDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function copyStaticAsset(relativePath) {
  const sourcePath = path.join(rootDir, relativePath);
  const targetPath = path.join(distDir, relativePath);
  const sourceStats = await fs.stat(sourcePath);

  if (sourceStats.isDirectory()) {
    await fs.cp(sourcePath, targetPath, { recursive: true });
    return;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function copyFrontendAssets() {
  await Promise.all(STATIC_ASSET_PATHS.map((relativePath) => copyStaticAsset(relativePath)));
}

async function writeNetlifyArtifacts() {
  await Promise.all([
    fs.writeFile(path.join(distDir, "_redirects"), REDIRECTS),
    fs.writeFile(path.join(distDir, "_headers"), HEADERS),
  ]);
}

async function main() {
  await ensureCleanDist();
  await copyFrontendAssets();
  await writeNetlifyArtifacts();
  process.stdout.write(`Built static site into ${path.relative(rootDir, distDir)}\n`);
}

main().catch((error) => {
  console.error("Static build failed:", error);
  process.exitCode = 1;
});
