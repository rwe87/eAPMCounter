/**
 * Watches the savegame folder, finds the running recording and reads it as it grows.
 * Every counted action of the own player feeds the counter.
 *
 * Observed behavior of the game (2026-09-19, build 180059):
 * - While a match runs, the game keeps writing to `rec.aoe2record`.
 * - Afterwards it renames the file to `MP Replay ... .aoe2record`.
 * - The next match creates or overwrites `rec.aoe2record`. Its creation time often
 *   stays old, so the last write time is what counts here.
 */
import { EventEmitter } from "node:events";
import { closeSync, fstatSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { EapmCounter } from "./eapm.ts";
import { actionName } from "./rec/actions.ts";
import { BodyParser } from "./rec/body.ts";
import {
  bytesNeededForHeader,
  findPlayerByProfileId,
  findPlayerNumber,
  parseHeader,
  type RecHeader,
} from "./rec/header.ts";

export interface WatcherState {
  inGame: boolean;
  eapm: number | null;
  gameTimeMs: number;
  file: string | null;
  players: { number: number; name: string }[];
  myPlayerNumber: number | null;
  totalCounted: number;
  note: string | null;
  updatedAt: string;
}

interface FileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

interface CurrentFile {
  path: string;
  /** Write time at the last look. When a skipped file changes, a new game has begun. */
  mtimeMs: number;
  /** Size at the last look. When it shrinks, the file was created anew. */
  size: number;
  /** First bytes of the file, used to recognize it again after a rename. */
  fingerprint: Buffer | null;
  header: RecHeader | null;
  parser: BodyParser | null;
  readPos: number;
  lastGrowthMs: number;
  myNumber: number | null;
  failed: string | null;
}

export type Logger = (msg: string) => void;

const FINGERPRINT_BYTES = 64;

export class RecWatcher extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private current: CurrentFile | null = null;
  private readonly counter: EapmCounter;
  private readonly excluded: Set<number>;
  private readonly startedAtMs: number;
  private eapm: number | null = null;

  constructor(
    private readonly cfg: Config,
    private readonly log: Logger = () => {},
    private readonly now: () => number = Date.now,
  ) {
    super();
    this.counter = new EapmCounter(cfg.windowSeconds * 1000);
    this.excluded = new Set(cfg.excludedActions);
    this.startedAtMs = now();
  }

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.cfg.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get state(): WatcherState {
    const c = this.current;
    const inGame = this.isInGame();
    return {
      inGame,
      eapm: inGame ? this.eapm : null,
      gameTimeMs: c?.parser?.gameTimeMs ?? 0,
      file: c?.path ?? null,
      players: c?.header?.players.filter((p) => p.name).map((p) => ({ number: p.number, name: p.name })) ?? [],
      myPlayerNumber: c?.myNumber ?? null,
      totalCounted: this.counter.total,
      note: c?.failed ?? null,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private isInGame(): boolean {
    const c = this.current;
    if (!c || !c.parser || c.failed || c.parser.finished) return false;
    return this.now() - c.lastGrowthMs < this.cfg.idleSeconds * 1000;
  }

  /** One check. Public so tests can call it directly. */
  tick(): void {
    try {
      this.tickInner();
    } catch (err) {
      this.log(`error while checking: ${(err as Error).message}`);
    }
  }

  private tickInner(): void {
    const newest = this.findNewestRecording();
    if (!newest) return;

    const c = this.current;
    if (!c) {
      this.startFile(newest);
    } else if (c.path !== newest.path) {
      if (this.isSameRecording(c, newest)) {
        this.log(`recording renamed: ${newest.path}`);
        c.path = newest.path;
      } else {
        this.startFile(newest);
      }
    } else if (newest.size < c.size || (c.failed && newest.mtimeMs !== c.mtimeMs && newest.size !== c.size)) {
      // The same file was created anew, or a skipped file is growing again.
      this.startFile(newest);
    }

    const cur = this.current!;
    cur.size = newest.size;
    cur.mtimeMs = newest.mtimeMs;
    if (cur.failed) return;

    const fd = openSync(cur.path, "r");
    try {
      const size = fstatSync(fd).size;
      if (!cur.header && !this.tryReadHeader(fd, size, cur)) return;
      if (size > cur.readPos) this.readNewBytes(fd, size, cur);
    } finally {
      closeSync(fd);
    }
  }

  private findNewestRecording(): FileInfo | null {
    let best: FileInfo | null = null;
    for (const name of readdirSync(this.cfg.savegameDir)) {
      if (!name.toLowerCase().endsWith(".aoe2record")) continue;
      const path = join(this.cfg.savegameDir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue; // just renamed or deleted
      }
      if (!best || st.mtimeMs > best.mtimeMs) best = { path, size: st.size, mtimeMs: st.mtimeMs };
    }
    return best;
  }

  /** Recognizes the renamed file by the start of its content. */
  private isSameRecording(c: CurrentFile, candidate: FileInfo): boolean {
    // After the end of the game, or with fewer bytes than already read, it cannot be
    // a continuation.
    if (!c.fingerprint || !c.parser || c.parser.finished || candidate.size < c.readPos) return false;
    const buf = Buffer.alloc(c.fingerprint.length);
    try {
      const fd = openSync(candidate.path, "r");
      try {
        readSync(fd, buf, 0, buf.length, 0);
      } finally {
        closeSync(fd);
      }
    } catch {
      return false;
    }
    return buf.equals(c.fingerprint);
  }

  private startFile(info: FileInfo): void {
    this.counter.reset();
    this.eapm = null;
    const stale = this.now() - info.mtimeMs > this.cfg.idleSeconds * 1000 && info.mtimeMs < this.startedAtMs;
    this.current = {
      path: info.path,
      mtimeMs: info.mtimeMs,
      size: info.size,
      fingerprint: null,
      header: null,
      parser: null,
      readPos: 0,
      lastGrowthMs: stale ? 0 : this.now(),
      myNumber: null,
      failed: stale ? "recording is older than this program and is no longer growing" : null,
    };
    if (stale) {
      this.log(`newest recording is old, skipping it: ${info.path}`);
    } else {
      this.log(`new recording: ${info.path}`);
    }
    this.emit("file", info.path);
  }

  private tryReadHeader(fd: number, size: number, c: CurrentFile): boolean {
    if (size < 4) return false;
    const lenBuf = Buffer.alloc(4);
    readSync(fd, lenBuf, 0, 4, 0);
    const needed = bytesNeededForHeader(lenBuf);
    if (needed === null || size < needed) return false;

    const buf = Buffer.alloc(needed);
    readSync(fd, buf, 0, needed, 0);
    try {
      c.header = parseHeader(buf);
    } catch (err) {
      c.failed = `header not readable: ${(err as Error).message}`;
      this.log(c.failed);
      return false;
    }
    c.fingerprint = Buffer.from(buf.subarray(0, FINGERPRINT_BYTES));
    c.parser = new BodyParser({ fileOffset: c.header.bodyOffset, withPrelude: true });
    c.readPos = c.header.bodyOffset;

    // The profile id belongs to an account and survives a rename, so it wins when set.
    // The recording's own perspective is deliberately not used here: a folder also holds
    // recordings from other people, and counting their actions would report a stranger's
    // rate as the user's own.
    c.myNumber =
      findPlayerByProfileId(c.header.players, this.cfg.playerProfileId) ??
      findPlayerNumber(c.header.players, this.cfg.playerName);

    const list = c.header.players
      .filter((p) => p.name)
      .map((p) => `${p.number}: ${p.name}${p.number === c.myNumber ? " (me)" : ""}`)
      .join(", ");
    this.log(`players: ${list || "(no names in the header)"}`);
    if (c.myNumber === null) {
      const wanted = this.cfg.playerProfileId
        ? `profile id ${this.cfg.playerProfileId}`
        : `player name "${this.cfg.playerName}"`;
      c.failed = `${wanted} not found in the recording, so nothing is counted`;
      this.log(c.failed);
      return false;
    }
    this.counter.markStart(this.cfg.timeBase === "game" ? 0 : this.now());
    this.emit("game-start", c.header);
    return true;
  }

  private readNewBytes(fd: number, size: number, c: CurrentFile): void {
    const parser = c.parser!;
    const length = size - c.readPos;
    const buf = Buffer.alloc(length);
    const got = readSync(fd, buf, 0, length, c.readPos);
    if (got <= 0) return;
    c.readPos += got;
    c.lastGrowthMs = this.now();

    let events;
    try {
      events = parser.feed(got === length ? buf : buf.subarray(0, got));
    } catch (err) {
      c.failed = `body not readable: ${(err as Error).message}`;
      this.log(c.failed);
      return;
    }

    const wall = this.now();
    for (const ev of events) {
      if (ev.kind === "action") {
        if (ev.playerId !== c.myNumber || this.excluded.has(ev.actionId)) continue;
        this.counter.add(this.cfg.timeBase === "game" ? ev.gameTimeMs : wall);
        this.emit("counted", actionName(ev.actionId), ev.gameTimeMs);
      } else if (ev.kind === "postgame") {
        this.log(`end of game read after ${Math.round(ev.gameTimeMs / 1000)} s of game time`);
        this.emit("game-end");
      }
    }
    this.eapm = this.counter.value(this.cfg.timeBase === "game" ? parser.gameTimeMs : wall);
  }
}
