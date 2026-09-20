/**
 * Reads the header of an .aoe2record file (Age of Empires II: Definitive Edition).
 *
 * Layout: 4 bytes header length, 4 unused bytes, then deflate-compressed header data
 * up to the header length. The log version (4 bytes) follows, then the body starts.
 *
 * Ported from parse_rec.ts (ozansahal/aoe2-record-viewer, MIT), which in turn ports
 * mgz/fast/header.py (happyleavesaoc/aoc-mgz, MIT). See THIRD_PARTY_LICENSES.md.
 * Only as much is read as the player list needs.
 */
import { inflateRawSync } from "node:zlib";
import { NeedMoreData, Stream } from "./stream.ts";

export interface RecPlayer {
  /** Player number 1 to 8. The same number appears in every action in the body. */
  number: number;
  name: string;
  profileId: number;
  colorId: number;
  teamId: number;
  civilizationId: number;
  /** Raw value from the file. Humans have a profileId greater than 0. */
  type: number;
  aiName: string;
}

export interface RecHeader {
  headerLen: number;
  /** Byte offset where the body starts (including the log version). */
  bodyOffset: number;
  gameVersion: string;
  saveVersion: number;
  logVersion: number;
  build: number | null;
  speed: number;
  numPlayers: number;
  multiplayer: boolean;
  recordGame: boolean;
  players: RecPlayer[];
}

/** Header length from the first 4 bytes. `null` while fewer than 4 bytes are available. */
export function readHeaderLen(buf: Buffer): number | null {
  if (buf.length < 4) return null;
  return buf.readUInt32LE(0);
}

/** Number of bytes that must be present before `parseHeader` can run. */
export function bytesNeededForHeader(buf: Buffer): number | null {
  const len = readHeaderLen(buf);
  return len === null ? null : len + 4;
}

export function parseHeader(file: Buffer): RecHeader {
  const headerLen = readHeaderLen(file);
  if (headerLen === null || headerLen < 8) throw new Error("header length missing or invalid");
  if (file.length < headerLen + 4) throw new NeedMoreData();

  const compressed = file.subarray(8, headerLen);
  const header = new Stream(Buffer.from(inflateRawSync(compressed)));
  const logVersion = file.readUInt32LE(headerLen);

  const gameVersion = header.bytes(7).toString("ascii");
  header.skip(1);
  let saveVersion = header.f32();
  if (saveVersion === -1) {
    saveVersion = header.u32();
    if (saveVersion !== 37) saveVersion /= 1 << 16;
  }
  saveVersion = Number(saveVersion.toFixed(2));

  const isDe = gameVersion === "VER 9.4" && (logVersion === 5 || saveVersion >= 12.97);
  if (!isDe) {
    throw new Error(
      `only Definitive Edition is supported (found: ${gameVersion}, save ${saveVersion}, log ${logVersion})`,
    );
  }

  const de = parseDe(header, saveVersion);
  return {
    headerLen,
    bodyOffset: headerLen,
    gameVersion,
    saveVersion,
    logVersion,
    build: de.build,
    speed: de.speed,
    numPlayers: de.numPlayers,
    multiplayer: de.multiplayer,
    recordGame: de.recordGame,
    players: de.players,
  };
}

function deString(d: Stream): Buffer {
  const marker = d.bytes(2);
  if (marker[0] !== 0x60 || marker[1] !== 0x0a) {
    throw new Error(`de_string marker missing at offset ${d.pos - 2}`);
  }
  const length = d.i16();
  if (length < 0) throw new Error("de_string with negative length");
  return d.bytes(length);
}

function utf8(buf: Buffer): string {
  return buf.toString("utf8").replace(/\0+$/, "");
}

interface DeSection {
  build: number | null;
  speed: number;
  numPlayers: number;
  multiplayer: boolean;
  recordGame: boolean;
  players: RecPlayer[];
}

/** Port of parseDe from parse_rec.ts, cut down to the part up to the player list. */
function parseDe(d: Stream, save: number): DeSection {
  let build: number | null = null;
  if (save >= 25.22) build = d.u32();
  if (save >= 26.16) d.u32(); // timestamp
  d.skip(12);
  const dlcCount = d.u32();
  for (let i = 0; i < dlcCount; i++) d.u32();
  d.skip(4);
  d.u32(); // map_dimension (>= 61.5) or difficulty
  d.skip(4);
  d.u32(); // rms_map_id
  d.skip(4);
  d.u32(); // victory_type_id
  d.u32(); // starting_resources_id
  d.u32(); // starting_age_id
  d.u32(); // ending_age_id
  d.skip(12);
  const speed = d.f32();
  d.u32(); // treaty_length
  d.u32(); // population_limit
  const numPlayers = d.u32();
  d.skip(14);
  if (save >= 61.5) d.u8(); // team_bonus_disabled / difficulty
  d.i8(); // random_positions
  d.i8(); // all_technologies
  d.skip(1);
  d.i8(); // lock_teams
  d.i8(); // lock_speed
  const multiplayer = d.i8();
  d.i8(); // cheats
  const recordGame = d.i8();
  d.i8(); // animals_enabled
  d.i8(); // predators_enabled
  d.i8(); // turbo_enabled
  d.i8(); // shared_exploration
  d.i8(); // team_positions
  d.skip(12);
  if (save >= 25.06) d.skip(1);
  if (save > 50) d.skip(1);

  const players: RecPlayer[] = [];
  const slots = save < 66.3 && save >= 37 ? numPlayers : 8;
  for (let i = 0; i < slots; i++) {
    d.skip(4);
    const colorId = d.i32();
    d.skip(2);
    const teamId = d.i8();
    d.skip(9);
    const civilizationId = d.u32();
    if (save >= 61.5) {
      const customCivCount = d.u32();
      if (save >= 63.0 && customCivCount > 0) {
        for (let c = 0; c < customCivCount; c++) d.u32();
      }
    }
    deString(d);
    d.skip(1);
    const aiName = deString(d);
    if (save >= 66.3) deString(d); // censored_name
    const name = deString(d);
    const type = d.u32();
    const profileId = d.u32();
    d.skip(4);
    const number = d.i32();
    if (save < 25.22) d.skip(8);
    d.i8(); // prefer_random
    d.skip(1);
    if (save >= 25.06) d.skip(8); // handicap
    if (save >= 64.3) d.skip(4);
    if (save >= 67.2) deString(d);

    players.push({
      number,
      name: utf8(name),
      profileId,
      colorId,
      teamId,
      civilizationId,
      type,
      aiName: utf8(aiName),
    });
  }

  return {
    build,
    speed,
    numPlayers,
    multiplayer: multiplayer === 1,
    recordGame: recordGame === 1,
    players,
  };
}

/**
 * Finds the player number for a name. The comparison ignores case and surrounding
 * whitespace. Returns `null` when no player matches.
 */
export function findPlayerNumber(players: RecPlayer[], name: string): number | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const hit = players.find((p) => p.name.trim().toLowerCase() === wanted);
  return hit ? hit.number : null;
}
