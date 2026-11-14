import assert from "node:assert/strict";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findDefaultSavegameDir, type Config } from "../src/config.ts";
import { DEFAULT_EXCLUDED_ACTIONS } from "../src/rec/actions.ts";
import { parseHeader } from "../src/rec/header.ts";
import { RecWatcher } from "../src/watcher.ts";

function newestRecording(): string | null {
  const dir = process.env.EAPM_SAVEGAME_DIR ?? findDefaultSavegameDir();
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((n) => n.startsWith("MP Replay") && n.toLowerCase().endsWith(".aoe2record"))
    .map((n) => join(dir, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

const rec = newestRecording();

/** Writes bytes `from` to `to` of the source into the target, leaving the rest alone. */
function writeRange(target: string, data: Buffer, from: number, to: number): void {
  const fd = openSync(target, existsSync(target) ? "r+" : "w");
  try {
    writeSync(fd, data, from, to - from, from);
  } finally {
    closeSync(fd);
  }
}

test("watcher: new file, follow along, rename, next game", { skip: !rec }, () => {
  const data = readFileSync(rec!);
  const header = parseHeader(data);
  const me = header.players.find((p) => p.name)!;

  const dir = mkdtempSync(join(tmpdir(), "eapm-watch-"));
  try {
    // An old, finished recording is already in the folder.
    const old = join(dir, "MP Replay old.aoe2record");
    writeFileSync(old, data);
    const oldTime = new Date(Date.now() - 3_600_000);
    // Push the write time back so the file counts as old.
    utimesSync(old, oldTime, oldTime);

    let clock = Date.now();
    const cfg: Config = {
      savegameDir: dir,
      playerName: me.name,
      playerProfileId: 0,
      port: 0,
      windowSeconds: 60,
      timeBase: "game",
      pollMs: 1000,
      idleSeconds: 180,
      excludedActions: DEFAULT_EXCLUDED_ACTIONS,
      overlayFontSize: "64px",
      overlayColor: "#ffffff",
    };
    const logs: string[] = [];
    const w = new RecWatcher(cfg, (m) => logs.push(m), () => clock);

    // At startup only the old file is there: no game.
    w.tick();
    assert.equal(w.state.inGame, false);
    assert.match(w.state.note ?? "", /older/);

    // The game creates rec.aoe2record and writes only part of the header at first.
    const live = join(dir, "rec.aoe2record");
    clock += 1000;
    writeRange(live, data, 0, 1000);
    w.tick();
    assert.equal(w.state.inGame, false, "header incomplete, no game yet");

    // Header complete plus a piece of the body.
    const third = Math.floor(data.length / 3);
    clock += 1000;
    writeRange(live, data, 1000, third);
    w.tick();
    assert.equal(w.state.inGame, true, "game detected");
    assert.equal(w.state.myPlayerNumber, me.number);
    const t1 = w.state.gameTimeMs;
    assert.ok(t1 > 0, "game time is running");

    // Another piece: game time grows, the counter fills up.
    clock += 1000;
    writeRange(live, data, third, 2 * third);
    w.tick();
    assert.ok(w.state.gameTimeMs > t1, "game time grew");
    assert.ok(w.state.totalCounted > 0, "actions counted");
    assert.equal(typeof w.state.eapm, "number");

    // The game renames the file. The watcher stays on the same recording.
    const renamed = join(dir, "MP Replay new.aoe2record");
    renameSync(live, renamed);
    const counted = w.state.totalCounted;
    clock += 1000;
    w.tick();
    assert.equal(w.state.file, renamed);
    assert.equal(w.state.totalCounted, counted, "renaming does not restart the count");
    assert.equal(w.state.inGame, true);

    // Rest of the file including the end of the game.
    clock += 1000;
    writeRange(renamed, data, 2 * third, data.length);
    w.tick();
    assert.equal(w.state.inGame, false, "end of game read");
    assert.ok(logs.some((l) => l.startsWith("end of game read")));

    // Next game: rec.aoe2record is created anew, small at first.
    clock += 5000;
    writeRange(live, data, 0, third);
    w.tick();
    assert.equal(w.state.file, live);
    assert.equal(w.state.inGame, true, "second game detected");
    assert.ok(w.state.totalCounted < counted, "the counter was reset");

    // Without further growth the game counts as over after idleSeconds.
    clock += 181_000;
    w.tick();
    assert.equal(w.state.inGame, false, "no more changes, no game");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
