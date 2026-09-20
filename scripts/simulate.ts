/**
 * Writes an existing recording into a test folder piece by piece.
 * That makes it possible to check the program without a running game.
 *
 * Run:  npm run simulate -- [source file] [--dir target] [--rate bytes/s] [--speed factor]
 *
 * Without a source file, the newest recording from config.txt is used.
 * Default target folder: .sim/savegame inside the project. Then start the program with
 *   EAPM_SAVEGAME_DIR=<target> npm start
 * or with "savegameDir" set accordingly.
 *
 * --speed follows game time: factor 1 writes as fast as the game ran, factor 10 ten times
 * faster. Without --speed a fixed rate applies (--rate, default 200000 bytes/s).
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, join } from "node:path";
import { PROJECT_ROOT, loadConfig } from "../src/config.ts";
import { BodyParser } from "../src/rec/body.ts";
import { parseHeader } from "../src/rec/header.ts";

const args = process.argv.slice(2);
function opt(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const positional = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));

const cfg = loadConfig();
let source = positional[0];
if (!source) {
  source = readdirSync(cfg.savegameDir)
    .filter((n) => n.toLowerCase().endsWith(".aoe2record"))
    .map((n) => join(cfg.savegameDir, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
if (!source || !existsSync(source)) {
  console.error("no source file found.");
  process.exit(1);
}

const targetDir = opt("--dir") ?? join(PROJECT_ROOT, ".sim", "savegame");
const rate = Number(opt("--rate") ?? 200_000);
const speed = opt("--speed") ? Number(opt("--speed")) : null;

mkdirSync(targetDir, { recursive: true });
for (const old of readdirSync(targetDir)) rmSync(join(targetDir, old));

const data = readFileSync(source);
const header = parseHeader(data);
const target = join(targetDir, `SIM ${new Date().toISOString().replace(/[:.]/g, "-")} ${basename(source)}`);
console.log(`source:  ${source} (${data.length} bytes)`);
console.log(`target:  ${target}`);
console.log(`players: ${header.players.filter((p) => p.name).map((p) => `${p.number}: ${p.name}`).join(", ")}`);

const fd = openSync(target, "w");
let pos = 0;

function write(n: number): void {
  const end = Math.min(data.length, pos + n);
  if (end > pos) {
    writeSync(fd, data, pos, end - pos, pos);
    pos = end;
  }
}

// Write the header at once. The game creates it when the match starts.
write(header.bodyOffset + 4);
console.log(`header written (${pos} bytes). Body follows.`);

if (speed === null) {
  const stepMs = 200;
  const perStep = Math.max(1, Math.round((rate * stepMs) / 1000));
  const timer = setInterval(() => {
    write(perStep);
    if (pos >= data.length) {
      clearInterval(timer);
      finish();
    }
  }, stepMs);
} else {
  // Find the byte offsets of the time steps, then replay them in game time.
  const parser = new BodyParser({ fileOffset: header.bodyOffset, withPrelude: true });
  const marks: { pos: number; timeMs: number }[] = [];
  const body = data.subarray(header.bodyOffset);
  const chunk = 4096;
  let consumed = header.bodyOffset;
  for (let off = 0; off < body.length; off += chunk) {
    const events = parser.feed(body.subarray(off, Math.min(body.length, off + chunk)));
    consumed = header.bodyOffset + Math.min(body.length, off + chunk) - parser.pendingBytes;
    const last = events.filter((e) => e.kind === "sync").at(-1);
    if (last) marks.push({ pos: consumed, timeMs: last.gameTimeMs });
  }
  const totalMs = parser.gameTimeMs;
  console.log(`total game time ${Math.round(totalMs / 1000)} s, replay factor ${speed}`);
  const startWall = Date.now();
  let idx = 0;
  const timer = setInterval(() => {
    const elapsedGame = (Date.now() - startWall) * speed;
    while (idx < marks.length && marks[idx].timeMs <= elapsedGame) idx++;
    const targetPos = idx < marks.length ? marks[idx].pos : data.length;
    write(targetPos - pos);
    if (pos >= data.length) {
      clearInterval(timer);
      finish();
    }
  }, 100);
}

function finish(): void {
  closeSync(fd);
  console.log(`done: ${pos} bytes written.`);
}
