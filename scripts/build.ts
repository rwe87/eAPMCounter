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
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inject } from "postject";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const exe = join(dist, "eAPMCounter.exe");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

console.log("1/4 bundling the program");
await build({
  entryPoints: [join(root, "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: join(dist, "main.cjs"),
  // The bundled program has no import.meta.url. paths.ts then uses process.execPath.
  define: { "import.meta.url": '""' },
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
if (existsSync(join(root, "config.txt"))) copyFileSync(join(root, "config.txt"), join(dist, "config.txt"));
writeFileSync(
  join(dist, "README.txt"),
  [
    "eAPMCounter for Age of Empires II: Definitive Edition",
    "",
    "1. Start eAPMCounter.exe. On the first start it creates config.txt next to itself.",
    "2. Put your own in-game name into config.txt if the guessed name is wrong.",
    "3. In OBS add a source of type Browser and set its URL to",
    "   http://localhost:8123/overlay",
    "   Width 200, height 90 is enough for the number. The background is transparent.",
    "4. eAPMCounter.exe has to run while you stream.",
    "",
    "http://localhost:8123/ shows the current state and the URL again.",
    "",
    "License notes for borrowed code are in THIRD_PARTY_LICENSES.md in the source project.",
  ].join("\r\n"),
);

const mb = (statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`done: ${exe} (${mb} MB)`);
