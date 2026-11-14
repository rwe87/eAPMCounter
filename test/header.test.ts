import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { findDefaultSavegameDir } from "../src/config.ts";
import { guessPlayer } from "../src/rec/guess.ts";
import { findPlayerByProfileId, findPlayerNumber, parseHeader } from "../src/rec/header.ts";
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

const PLAYERS = [
  { number: 1, name: "Alice", profileId: 111, colorId: 0, teamId: 1, civilizationId: 1, type: 2, aiName: "" },
  { number: 2, name: " Bob ", profileId: 222, colorId: 1, teamId: 2, civilizationId: 1, type: 2, aiName: "" },
];

test("findPlayerNumber ignores case", () => {
  assert.equal(findPlayerNumber(PLAYERS, "alice"), 1);
  assert.equal(findPlayerNumber(PLAYERS, "BOB"), 2);
  assert.equal(findPlayerNumber(PLAYERS, "carol"), null);
  assert.equal(findPlayerNumber(PLAYERS, ""), null);
});

test("findPlayerByProfileId matches the account, not the name", () => {
  assert.equal(findPlayerByProfileId(PLAYERS, 222), 2);
  assert.equal(findPlayerByProfileId(PLAYERS, 999), null);
  // 0 means "not set" and must never match a player.
  assert.equal(findPlayerByProfileId(PLAYERS, 0), null);
  const renamed = [{ ...PLAYERS[0], name: "Alice2" }, PLAYERS[1]];
  assert.equal(findPlayerByProfileId(renamed, 111), 1);
});

test("every recording names the perspective it was written from", { skip: recs.length === 0 }, () => {
  for (const rec of recs) {
    const h = parseHeader(readFileSync(rec));
    assert.notEqual(h.ownerNumber, null, `${rec}: no perspective read`);
    const owner = h.players.find((p) => p.number === h.ownerNumber);
    assert.ok(owner, `${rec}: perspective ${h.ownerNumber} is not one of the players`);
    assert.ok(owner.name.trim(), `${rec}: the perspective has no name`);
  }
});

test("the folder owner is found from the perspectives", { skip: recs.length === 0 }, () => {
  const dir = process.env.EAPM_SAVEGAME_DIR ?? findDefaultSavegameDir();
  const guess = guessPlayer(dir!, 50);
  assert.ok(guess, "no owner found");
  assert.ok(guess.profileId > 0, "owner without a profile id");
  assert.ok(guess.name.trim(), "owner without a name");
  // The owner has to win clearly, otherwise the guess is a coin toss.
  assert.ok(guess.hits > guess.files / 3, `only ${guess.hits} of ${guess.files} recordings from this perspective`);
});
