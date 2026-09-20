import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { findDefaultSavegameDir } from "../src/config.ts";
import { Action } from "../src/rec/actions.ts";
import { BodyParser, playerIdOf, type BodyEvent } from "../src/rec/body.ts";
import { parseHeader } from "../src/rec/header.ts";

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

/** Builds an action in the layout used since build 71094: player, length, payload, sequence. */
function actionOp(actionId: number, playerId: number, payloadLen = 4, sequence = 7): Buffer {
  const inner = Buffer.alloc(3 + payloadLen);
  inner.writeInt8(playerId, 0);
  inner.writeInt16LE(payloadLen, 1);
  return Buffer.concat([u32(1), u32(1 + inner.length), Buffer.from([actionId]), inner, u32(sequence)]);
}

/** A time step in the short form (a non-zero marker follows). */
function syncShort(incMs: number): Buffer {
  return Buffer.concat([u32(2), u32(incMs)]);
}

/** A time step in the long DE form. */
function syncDe(incMs: number, currentTime: number): Buffer {
  const block = Buffer.alloc(4 * 8 * 11);
  block.writeUInt32LE(1, 12); // isDe at offset 12
  return Buffer.concat([u32(2), u32(incMs), u32(0), block, u32(currentTime)]);
}

function viewlock(): Buffer {
  return Buffer.concat([u32(3), Buffer.alloc(12)]);
}

function chat(text: string): Buffer {
  const t = Buffer.from(text, "utf8");
  return Buffer.concat([u32(4), u32(0xffffffff), u32(t.length), t]);
}

function build(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

test("reads synthetic operations and adds up the game time", () => {
  const body = build(
    syncShort(1000),
    actionOp(Action.MOVE, 1),
    syncDe(500, 1500),
    actionOp(Action.BUILD, 2),
    viewlock(),
    chat("hello"),
    syncShort(250),
    viewlock(), // a short time step is only complete once the next operation starts
  );
  const p = new BodyParser({ withPrelude: false });
  const events = p.feed(body);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["sync", "action", "sync", "action", "viewlock", "chat", "sync", "viewlock"],
  );
  const actions = events.filter((e) => e.kind === "action") as Extract<BodyEvent, { kind: "action" }>[];
  assert.equal(actions[0].playerId, 1);
  assert.equal(actions[0].gameTimeMs, 1000);
  assert.equal(actions[1].playerId, 2);
  assert.equal(actions[1].gameTimeMs, 1500);
  assert.equal(p.gameTimeMs, 1750);
  assert.equal(p.pendingBytes, 0);
});

test("resumes an incomplete operation on the next feed", () => {
  const body = build(syncShort(1000), actionOp(Action.MOVE, 3), syncShort(200), viewlock());
  const whole = new BodyParser({ withPrelude: false }).feed(body);

  for (const size of [1, 2, 3, 5, 7]) {
    const p = new BodyParser({ withPrelude: false });
    const got: BodyEvent[] = [];
    for (let i = 0; i < body.length; i += size) got.push(...p.feed(body.subarray(i, i + size)));
    assert.deepEqual(got, whole, `chunk size ${size}`);
    assert.equal(p.pendingBytes, 0);
  }
});

test("the end of the game stops the parser", () => {
  const body = build(syncShort(1), u32(6), Buffer.alloc(100, 0xaa));
  const p = new BodyParser({ withPrelude: false });
  const events = p.feed(body);
  assert.equal(events.at(-1)?.kind, "postgame");
  assert.equal(p.finished, true);
  assert.deepEqual(p.feed(Buffer.alloc(10)), []);
});

test("player number: new and old layout", () => {
  const modern = Buffer.from([4, 2, 0, 0xaa, 0xbb]); // player 4, length 2, 2 bytes
  assert.equal(playerIdOf(Action.MOVE, modern), 4);
  const legacy = Buffer.from([5, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(playerIdOf(Action.MOVE, legacy), 5);
  const game = Buffer.from([1, 6, 0, 0, 0, 0, 0, 0]);
  assert.equal(playerIdOf(Action.GAME, game), 6);
  assert.equal(playerIdOf(Action.MOVE, Buffer.alloc(0)), -1);
});

// Checks against a real recording, when one is available.
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

test("real recording: reading in chunks gives the same result as reading at once", { skip: !rec }, () => {
  const data = readFileSync(rec!);
  const header = parseHeader(data);
  const body = data.subarray(header.bodyOffset);

  const whole = new BodyParser({ fileOffset: header.bodyOffset });
  const wholeEvents = whole.feed(body);
  assert.ok(wholeEvents.length > 100, "too few operations read");
  assert.ok(whole.gameTimeMs > 60_000, "game time too short");

  for (const size of [17, 4096, 65536]) {
    const p = new BodyParser({ fileOffset: header.bodyOffset });
    const events: BodyEvent[] = [];
    for (let i = 0; i < body.length; i += size) events.push(...p.feed(body.subarray(i, i + size)));
    assert.equal(events.length, wholeEvents.length, `chunk size ${size}: count`);
    assert.deepEqual(events, wholeEvents, `chunk size ${size}: content`);
    assert.equal(p.gameTimeMs, whole.gameTimeMs, `chunk size ${size}: game time`);
  }
});

test("real recording: game time matches the span between creation and last write", { skip: !rec }, () => {
  const data = readFileSync(rec!);
  const header = parseHeader(data);
  const p = new BodyParser({ fileOffset: header.bodyOffset });
  p.feed(data.subarray(header.bodyOffset));
  const st = statSync(rec!);
  const wallMs = st.mtimeMs - st.birthtimeMs;
  // Depending on the speed setting, game time runs up to 1.7 times faster than the clock.
  // Loading and the post-game screen add to the clock side.
  assert.ok(p.gameTimeMs > wallMs * 0.5, `game time ${p.gameTimeMs} ms far below the span ${wallMs} ms`);
  assert.ok(p.gameTimeMs < wallMs * 2.5, `game time ${p.gameTimeMs} ms far above the span ${wallMs} ms`);
});

test("real recording: actions carry valid player numbers", { skip: !rec }, () => {
  const data = readFileSync(rec!);
  const header = parseHeader(data);
  const p = new BodyParser({ fileOffset: header.bodyOffset });
  const events = p.feed(data.subarray(header.bodyOffset));
  const valid = new Set(header.players.filter((pl) => pl.name || pl.aiName).map((pl) => pl.number));
  const actions = events.filter((e) => e.kind === "action") as Extract<BodyEvent, { kind: "action" }>[];
  const bad = actions.filter((a) => !valid.has(a.playerId));
  assert.ok(actions.length > 50, "too few actions");
  assert.ok(bad.length / actions.length < 0.02, `${bad.length} of ${actions.length} actions have an unknown player number`);
});
