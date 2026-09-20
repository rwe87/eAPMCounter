/**
 * Prints size and write time of the newest recording every 2 seconds.
 * Use it to check whether the game writes the file while a match is running.
 *
 * Run:  npm run check-growth
 * Then start a match in the game and watch the output.
 */
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";

const cfg = loadConfig();
console.log(`folder: ${cfg.savegameDir}`);
console.log("Ctrl+C stops.\n");

let lastPath = "";
let lastSize = -1;

function newest(): { path: string; size: number; mtime: Date; birth: Date } | null {
  let best: { path: string; size: number; mtime: Date; birth: Date; birthMs: number } | null = null;
  for (const name of readdirSync(cfg.savegameDir)) {
    if (!name.toLowerCase().endsWith(".aoe2record")) continue;
    const path = join(cfg.savegameDir, name);
    const st = statSync(path);
    const birthMs = st.birthtimeMs || st.mtimeMs;
    if (!best || birthMs > best.birthMs) {
      best = { path, size: st.size, mtime: st.mtime, birth: st.birthtime, birthMs };
    }
  }
  return best;
}

function canRead(path: string): string {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(4);
      const n = readSync(fd, buf, 0, 4, 0);
      return n === 4 ? `readable, header length ${buf.readUInt32LE(0)}` : "readable, still empty";
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    return `NOT readable: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`;
  }
}

function tick(): void {
  const f = newest();
  const t = new Date().toLocaleTimeString();
  if (!f) {
    console.log(`${t}  no .aoe2record file found`);
    return;
  }
  if (f.path !== lastPath) {
    console.log(`\n${t}  newest file: ${f.path}`);
    console.log(`          created ${f.birth.toLocaleString()}, ${canRead(f.path)}`);
    lastPath = f.path;
    lastSize = -1;
  }
  const delta = lastSize < 0 ? "" : `  (+${f.size - lastSize} bytes)`;
  console.log(`${t}  size ${f.size} bytes${delta}, last written ${f.mtime.toLocaleTimeString()}`);
  lastSize = f.size;
}

tick();
setInterval(tick, 2000);
