/**
 * Prints the player lists of the newest recordings and marks the perspective each one
 * was written from. Use it to find the value for "playerProfileId" in config.txt.
 *
 * Run:  npm run players            (newest 5)
 *       npm run players -- 20      (newest 20)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { guessPlayer } from "../src/rec/guess.ts";
import { parseHeader } from "../src/rec/header.ts";

const cfg = loadConfig();
const limit = Number(process.argv[2] ?? 5);

const files = readdirSync(cfg.savegameDir)
  .filter((n) => n.toLowerCase().endsWith(".aoe2record"))
  .map((n) => ({ path: join(cfg.savegameDir, n), mtime: statSync(join(cfg.savegameDir, n)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, limit);

for (const f of files) {
  console.log(`\n${f.path}`);
  try {
    const h = parseHeader(readFileSync(f.path));
    console.log(`  version ${h.gameVersion} save ${h.saveVersion}, build ${h.build ?? "?"}, ${h.numPlayers} players`);
    for (const p of h.players) {
      if (!p.name && !p.aiName) continue;
      const mark = p.number === h.ownerNumber ? "  <- recorded from here" : "";
      console.log(`  ${p.number}: ${(p.name || "(AI: " + p.aiName + ")").padEnd(24)} profile ${String(p.profileId).padEnd(10)}${mark}`);
    }
    if (h.ownerNumber !== null && !h.players.some((p) => p.number === h.ownerNumber)) {
      console.log(`  recorded from player ${h.ownerNumber}, who is not in the list`);
    }
  } catch (err) {
    console.log(`  error: ${(err as Error).message}`);
  }
}

const guess = guessPlayer(cfg.savegameDir);
if (guess) {
  console.log(`\nThis folder looks like it belongs to "${guess.name}", profile id ${guess.profileId}.`);
  console.log(`That perspective wrote ${guess.hits} of the ${guess.files} newest recordings.`);
  console.log(`Put this into config.txt:  playerProfileId = ${guess.profileId}`);
}
