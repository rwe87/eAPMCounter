/**
 * Works out who owns this savegame folder.
 *
 * Every recording names the player it was written from the perspective of. For a game
 * the local client recorded, that is the person sitting at this machine. A folder also
 * collects recordings from elsewhere, downloaded or handed over, and those name someone
 * else. So the owner of the folder is the perspective that comes up most often, counted
 * over enough recordings that a run of foreign ones cannot win.
 *
 * The result is used to identify the player, never to decide who to count in a single
 * recording: that would report a stranger's actions as the user's own.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseHeader } from "./header.ts";

export interface Guess {
  name: string;
  profileId: number;
  /** How many of the recordings read were written from this player's perspective. */
  hits: number;
  /** How many recordings could be read at all. */
  files: number;
}

export function guessPlayer(savegameDir: string, limit = 50): Guess | null {
  const files = readdirSync(savegameDir)
    .filter((n) => n.toLowerCase().endsWith(".aoe2record"))
    .map((n) => join(savegameDir, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, limit);

  const counts = new Map<number, { name: string; profileId: number; hits: number }>();
  let parsed = 0;
  for (const path of files) {
    let header;
    try {
      header = parseHeader(readFileSync(path));
    } catch {
      continue; // unreadable or still incomplete
    }
    parsed++;
    if (header.ownerNumber === null) continue;
    const owner = header.players.find((p) => p.number === header.ownerNumber);
    if (!owner || !owner.name.trim() || !owner.profileId) continue;
    const seen = counts.get(owner.profileId);
    if (seen) seen.hits++;
    else counts.set(owner.profileId, { name: owner.name.trim(), profileId: owner.profileId, hits: 1 });
  }

  let best: Guess | null = null;
  for (const c of counts.values()) {
    if (!best || c.hits > best.hits) best = { ...c, files: parsed };
  }
  return best;
}
