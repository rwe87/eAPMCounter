/**
 * Reads the body of an .aoe2record file piece by piece.
 *
 * The body is not compressed. It starts right after the header with the log version
 * (4 bytes) and a start block. A sequence of operations follows. Each one begins with
 * a 4-byte type id (see `Operation`).
 *
 * `feed()` takes new bytes and returns the operations that are now complete. When the
 * last operation is still incomplete, the parser keeps the remaining bytes and resumes
 * there on the next `feed()`. That is what makes it possible to follow a file while the
 * game is still writing it.
 *
 * Byte layouts ported from parse_rec.ts (ozansahal/aoe2-record-viewer, MIT), which ports
 * mgz/fast/__init__.py (happyleavesaoc/aoc-mgz, MIT). See THIRD_PARTY_LICENSES.md.
 */
import { Action, Operation } from "./actions.ts";
import { NeedMoreData, Stream } from "./stream.ts";

export type BodyEvent =
  | { kind: "action"; actionId: number; playerId: number; sequence: number; gameTimeMs: number }
  | { kind: "sync"; incrementMs: number; gameTimeMs: number }
  | { kind: "viewlock"; gameTimeMs: number }
  | { kind: "chat"; gameTimeMs: number; text: string }
  | { kind: "start"; gameTimeMs: number }
  | { kind: "postgame"; gameTimeMs: number }
  | { kind: "skipped"; opId: number; gameTimeMs: number };

export class BodyParseError extends Error {}

const MAX_PLAYERS = 8;
const SYNC_LEN_PER_PLAYER = 11;
const SYNC_DE_BLOCK = 4 * MAX_PLAYERS * SYNC_LEN_PER_PLAYER;
const MAX_SKIP = 64 * 1024 * 1024;

export interface BodyParserOptions {
  /**
   * Absolute offset in the file where the first bytes passed to `feed()` sit.
   * Needed for operations of unknown type, whose length is stored as a file offset.
   */
  fileOffset?: number;
  /** `false` when the bytes start after the log version and the start block. */
  withPrelude?: boolean;
}

export class BodyParser {
  private pending: Buffer = Buffer.alloc(0);
  /** Absolute file offset of the first byte in `pending`. */
  private pendingOffset: number;
  private preludeDone: boolean;
  private _gameTimeMs = 0;
  private _finished = false;
  private _actions = 0;

  constructor(options: BodyParserOptions = {}) {
    this.pendingOffset = options.fileOffset ?? 0;
    this.preludeDone = options.withPrelude === false;
  }

  /** Sum of all time increments, i.e. the game time in milliseconds. */
  get gameTimeMs(): number {
    return this._gameTimeMs;
  }

  /** `true` once the end-of-game block has been read. */
  get finished(): boolean {
    return this._finished;
  }

  /** Number of actions read, for all players. */
  get actionCount(): number {
    return this._actions;
  }

  /** Bytes still waiting to be completed. */
  get pendingBytes(): number {
    return this.pending.length;
  }

  feed(chunk: Buffer): BodyEvent[] {
    const events: BodyEvent[] = [];
    if (this._finished) return events;

    const buf = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const s = new Stream(buf);

    for (;;) {
      const mark = s.pos;
      try {
        if (!this.preludeDone) {
          this.readPrelude(s);
          this.preludeDone = true;
          continue;
        }
        if (s.remaining === 0) break;
        const ev = this.readOperation(s, this.pendingOffset + mark);
        if (ev) events.push(ev);
        if (this._finished) {
          this.pending = Buffer.alloc(0);
          return events;
        }
      } catch (err) {
        if (err instanceof NeedMoreData) {
          s.pos = mark;
          break;
        }
        throw err;
      }
    }

    this.pending = Buffer.from(buf.subarray(s.pos));
    this.pendingOffset += s.pos;
    return events;
  }

  /** Log version and start block (mgz: `meta`). */
  private readPrelude(s: Stream): void {
    s.u32(); // log version
    const first = s.u32();
    if (first !== 500) s.skip(4);
    s.skip(20);
    const a = s.u32();
    const b = s.u32();
    s.u32();
    if (a !== 0) s.seek(s.pos - 12);
    if (b === 2) s.seek(s.pos - 8);
  }

  private readOperation(s: Stream, absPos: number): BodyEvent | null {
    const opId = s.u32();
    const t = this._gameTimeMs;
    switch (opId) {
      case Operation.ACTION:
        return this.readAction(s);
      case Operation.SYNC: {
        const inc = this.readSync(s);
        this._gameTimeMs += inc;
        return { kind: "sync", incrementMs: inc, gameTimeMs: this._gameTimeMs };
      }
      case Operation.VIEWLOCK:
        s.skip(12);
        return { kind: "viewlock", gameTimeMs: t };
      case Operation.CHAT: {
        s.u32();
        const length = s.u32();
        const text = s.bytes(length).toString("utf8").replace(/\0+$/, "");
        return { kind: "chat", gameTimeMs: t, text };
      }
      case Operation.START:
        this.readStart(s);
        return { kind: "start", gameTimeMs: t };
      case Operation.POSTGAME:
        this._finished = true;
        return { kind: "postgame", gameTimeMs: t };
      default: {
        // mgz: saveOp. The number after the type id is an absolute file offset to
        // skip forward to.
        const target = s.u32();
        s.u32();
        const skip = target - absPos - 8;
        if (skip < 0 || skip > MAX_SKIP) {
          throw new BodyParseError(
            `unknown operation ${opId} at offset ${absPos} with unusable length ${target}`,
          );
        }
        s.skip(skip);
        return { kind: "skipped", opId, gameTimeMs: t };
      }
    }
  }

  private readAction(s: Stream): BodyEvent {
    const length = s.u32();
    if (length < 1 || length > MAX_SKIP) {
      throw new BodyParseError(`action with unusable length ${length}`);
    }
    const actionId = s.u8();
    const payload = s.bytes(length - 1);
    if (actionId === Action.POSTGAME) {
      this._finished = true;
      return { kind: "postgame", gameTimeMs: this._gameTimeMs };
    }
    const sequence = s.u32();
    this._actions++;
    return {
      kind: "action",
      actionId,
      playerId: playerIdOf(actionId, payload),
      sequence,
      gameTimeMs: this._gameTimeMs,
    };
  }

  private readSync(s: Stream): number {
    const increment = s.u32();
    const marker = s.peekU32();
    if (marker !== 0) return increment;
    s.u32(); // marker
    const chunkStart = s.pos;
    s.skip(12);
    const isDe = s.u32();
    if (!isDe) {
      s.skip(8);
      return increment;
    }
    s.seek(chunkStart);
    s.skip(SYNC_DE_BLOCK);
    s.u32(); // current_time
    return increment;
  }

  private readStart(s: Stream): void {
    s.skip(20);
    const next = s.peekU32();
    if (next === 0) {
      s.skip(4);
      const aok = s.peekU32();
      if (aok !== 2) s.skip(4);
    }
  }
}

/**
 * Player number from an action payload.
 *
 * Since build 71094 the payload starts with the player number (1 byte) and a length
 * (2 bytes), and the total length is that length plus 3. Before that, the player number
 * is the first byte for almost every action, and the second byte for GAME.
 */
export function playerIdOf(actionId: number, payload: Buffer): number {
  if (payload.length === 0) return -1;
  if (payload.length >= 3) {
    const declared = payload.readInt16LE(1);
    if (payload.length === declared + 3) return payload.readInt8(0);
  }
  if (actionId === Action.GAME) return payload.length > 1 ? payload.readInt8(1) : -1;
  return payload.readInt8(0);
}
