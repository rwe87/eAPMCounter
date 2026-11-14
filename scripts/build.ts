/**
 * Builds dist/eAPMCounter.exe: a single file containing Node and the program.
 *
 * Steps (Node's Single Executable Application):
 * 1. esbuild bundles src/main.ts and its dependencies into dist/main.cjs.
 * 2. Node turns that and the overlay files into a blob.
 * 3. node.exe is copied to dist/eAPMCounter.exe.
 * 4. postject appends the blob to that copy.
 *
 * Run:  npm run build
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inject } from "postject";
import { DEFAULT_CONFIG_TEXT } from "../src/config.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const exe = join(dist, "eAPMCounter.exe");

/**
 * The version baked into the EXE. The release workflow passes the tag. A build from a
 * working copy has no tag, and "dev" switches the update check off, which is what a
 * working copy should do.
 */
const version = process.env.EAPM_VERSION?.trim() || "dev";

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

console.log(`1/4 bundling the program as version ${version}`);
await build({
  entryPoints: [join(root, "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node26",
  outfile: join(dist, "main.cjs"),
  define: {
    // The bundled program has no import.meta.url. paths.ts then uses process.execPath.
    "import.meta.url": '""',
    __EAPM_VERSION__: JSON.stringify(version),
  },
  logLevel: "warning",
});

console.log("2/4 creating the blob");
const seaConfig = {
  main: join(dist, "main.cjs"),
  output: join(dist, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets: {
    "overlay.html": join(root, "overlay", "overlay.html"),
    "overlay.css": join(root, "overlay", "overlay.css"),
    "overlay.js": join(root, "overlay", "overlay.js"),
  },
};
const seaConfigPath = join(dist, "sea-config.json");
writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));
const sea = spawnSync(process.execPath, ["--experimental-sea-config", seaConfigPath], { stdio: "inherit" });
if (sea.status !== 0) {
  console.error("the blob could not be created.");
  process.exit(1);
}

console.log("3/4 copying node.exe");
copyFileSync(process.execPath, exe);

console.log("4/4 appending the blob");
await inject(exe, "NODE_SEA_BLOB", readFileSync(join(dist, "sea-prep.blob")), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});

rmSync(join(dist, "main.cjs"));
rmSync(join(dist, "sea-prep.blob"));
rmSync(seaConfigPath);

// The settings that ship with the build are the defaults, never the developer's own
// config.txt: that one carries a personal player name.
writeFileSync(join(dist, "config.txt"), DEFAULT_CONFIG_TEXT);

// The EXE carries code ported from two MIT projects, and MIT asks for the notice to
// travel with every copy. So the file goes into the package, not just into the repo.
copyFileSync(join(root, "THIRD_PARTY_LICENSES.md"), join(dist, "THIRD_PARTY_LICENSES.md"));

writeFileSync(
  join(dist, "README.txt"),
  [
    "eAPMCounter for Age of Empires II: Definitive Edition",
    "",
    "Shows the effective actions per minute (eAPM) of the last game minute on stream.",
    "",
    "1. Start eAPMCounter.exe. On the first start it reads config.txt next to itself",
    "   and guesses your in-game name from your recent recordings.",
    "2. Put your own in-game name into config.txt if the guessed name is wrong.",
    "3. In OBS add a source of type Browser and set its URL to",
    "   http://localhost:8123/overlay",
    "   Width 200, height 90 is enough for the number. The background is transparent.",
    "4. eAPMCounter.exe has to run while you stream.",
    "",
    "http://localhost:8123/ shows the current state and the URL again.",
    "http://localhost:8123/overlay?bg=green shows the overlay in a normal browser.",
    "",
    "Needs 64-bit Windows 10 or newer. No installation, no extra runtime.",
    "",
    "The program contains code ported from two MIT-licensed projects.",
    "See THIRD_PARTY_LICENSES.md next to this file.",
  ].join("\r\n"),
);

// The updater downloads this file directly rather than the ZIP, so it needs no way to
// unpack one. The checksum is what it verifies the download against.
const sha256 = createHash("sha256").update(readFileSync(exe)).digest("hex");
writeFileSync(join(dist, "eAPMCounter.exe.sha256"), `${sha256}  eAPMCounter.exe\n`);

const mb = (statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`done: ${exe} (${mb} MB), version ${version}`);
console.log(`sha256: ${sha256}`);
