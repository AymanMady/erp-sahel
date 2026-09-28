/**
 * Desktop release without GitHub Actions: gathers the installers built on this
 * computer, with their signatures, into `downloads/`, and writes the update manifest
 * (`latest.json`) pointing at the address the files will be downloaded from:
 *
 *   npm run desktop:release -- https://erp.example.com/downloads
 *
 * The web app serves `downloads/` at `/downloads/`: commit it and deploy, then set
 * `DESKTOP_UPDATE_MANIFEST_URL=https://erp.example.com/downloads/latest.json`. The
 * folder can also be uploaded as is to any web space.
 *
 * Installers are expected where `tauri build` leaves them, signed (`.sig` next to them):
 * Linux in `src-tauri/target/release/bundle`, Windows (built from Linux with
 * `--runner cargo-xwin --target x86_64-pc-windows-msvc`) in
 * `src-tauri/target/x86_64-pc-windows-msvc/release/bundle`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version: string = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
).version;

const baseUrl = process.argv[2]?.replace(/\/+$/, "");
if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
  console.error("Usage: npm run desktop:release -- https://address-of-the-web-space");
  process.exit(1);
}

/** Where each installer comes from, and the manifest keys it answers. */
const sources = [
  // The .deb only: the AppImage weighs about fifteen times more.
  {
    dir: "src-tauri/target/release/bundle/deb",
    extension: ".deb",
    keys: ["linux-x86_64", "linux-x86_64-deb"],
  },
  {
    dir: "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis",
    extension: "-setup.exe",
    keys: ["windows-x86_64", "windows-x86_64-nsis"],
  },
];

const outDir = path.join(rootDir, "downloads");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const platforms: Record<string, { url: string; signature: string }> = {};
for (const source of sources) {
  const dir = path.join(rootDir, source.dir);
  const file = fs.existsSync(dir)
    ? fs.readdirSync(dir).find((name) => name.endsWith(source.extension) && name.includes(version))
    : undefined;
  if (!file) {
    console.warn(`Skipped: no ${source.extension} of ${version} in ${source.dir}`);
    continue;
  }
  const signaturePath = path.join(dir, `${file}.sig`);
  if (!fs.existsSync(signaturePath)) {
    console.error(`${file} is not signed: build it with TAURI_SIGNING_PRIVATE_KEY set.`);
    process.exit(1);
  }
  // No spaces in addresses: "ERP Sahel_1.0.0_amd64.deb" becomes "ERP-Sahel_1.0.0_amd64.deb".
  const published = file.replace(/\s+/g, "-");
  fs.copyFileSync(path.join(dir, file), path.join(outDir, published));
  const entry = {
    url: `${baseUrl}/${encodeURIComponent(published)}`,
    signature: fs.readFileSync(signaturePath, "utf8").trim(),
  };
  for (const key of source.keys) platforms[key] = entry;
  console.log(`Added ${published}`);
}

if (Object.keys(platforms).length === 0) {
  console.error("No installer found: run the desktop builds first.");
  process.exit(1);
}

fs.writeFileSync(
  path.join(outDir, "latest.json"),
  `${JSON.stringify({ version, notes: "", pub_date: new Date().toISOString(), platforms }, null, 2)}\n`
);
console.log(`\ndownloads/ is ready, to be served at ${baseUrl}/`);
