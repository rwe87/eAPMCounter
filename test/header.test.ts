import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { findDefaultSavegameDir } from "../src/config.ts";
import { findPlayerNumber, parseHeader } from "../src/rec/header.ts";
import { NeedMoreData } from "../src/rec/stream.ts";

function recordings(limit: number): string[] {
  const dir = process.env.EAPM_SAVEGAME_DIR ?? findDefaultSavegameDir();
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.startsWith("MP Replay") && n.toLowerCase().endsWith(".aoe2record"))
    .map((n) => join(dir, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, limit);
}

const recs = recordings(5);

test("the header of the newest recordings yields named players", { skip: recs.length === 0 }, () => {
  for (const rec of recs) {
    const h = parseHeader(readFileSync(rec));
    assert.equal(h.gameVersion, "VER 9.4", rec);
    assert.ok(h.saveVersion > 60, `${rec}: save ${h.saveVersion}`);
    const named = h.players.filter((p) => p.name);
    assert.ok(named.length >= 2, `${rec}: only ${named.length} named players`);
    for (const p of named) {
      assert.ok(p.number >= 1 && p.number <= 8, `${rec}: player number ${p.number}`);
    }
    assert.ok(h.numPlayers >= 2 && h.numPlayers <= 8, `${rec}: numPlayers ${h.numPlayers}`);
  }
});

test("an incomplete header reports NeedMoreData", { skip: recs.length === 0 }, () => {
  const data = readFileSync(recs[0]);
  const headerLen = data.readUInt32LE(0);
  assert.throws(() => parseHeader(data.subarray(0, headerLen - 100)), NeedMoreData);
  assert.throws(() => parseHeader(data.subarray(0, headerLen + 2)), NeedMoreData);
});

test("findPlayerNumber ignores case", () => {
  const players = [
    { number: 1, name: "Alice", profileId: 1, colorId: 0, teamId: 1, civilizationId: 1, type: 2, aiName: "" },
    { number: 2, name: " Bob ", profileId: 2, colorId: 1, teamId: 2, civilizationId: 1, type: 2, aiName: "" },
  ];
  assert.equal(findPlayerNumber(players, "alice"), 1);
  assert.equal(findPlayerNumber(players, "BOB"), 2);
  assert.equal(findPlayerNumber(players, "carol"), null);
  assert.equal(findPlayerNumber(players, ""), null);
});
