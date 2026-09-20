/**
 * Guesses the own player name: the name that appears most often in the recent
 * recordings of the folder. Every recording was saved by the same player, so their
 * name is in all of them.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseHeader } from "./header.ts";

export interface Guess {
  name: string;
  hits: number;
  files: number;
}

export function guessPlayerName(savegameDir: string, limit = 10): Guess | null {
  const files = readdirSync(savegameDir)
    .filter((n) => n.toLowerCase().endsWith(".aoe2record"))
    .map((n) => join(savegameDir, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, limit);

  const counts = new Map<string, number>();
  let parsed = 0;
  for (const path of files) {
    try {
      const header = parseHeader(readFileSync(path));
      parsed++;
      for (const p of header.players) {
        const name = p.name.trim();
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    } catch {
      // unreadable or incomplete file: skip it
    }
  }
  let best: Guess | null = null;
  for (const [name, hits] of counts) {
    if (!best || hits > best.hits) best = { name, hits, files: parsed };
  }
  return best;
}
