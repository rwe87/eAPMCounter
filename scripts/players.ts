/**
 * Prints the player lists of the newest recordings.
 * Use it to find the name for "playerName" in config.txt.
 *
 * Run:  npm run players            (newest 5)
 *       npm run players -- 20      (newest 20)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { parseHeader } from "../src/rec/header.ts";

const cfg = loadConfig();
const limit = Number(process.argv[2] ?? 5);

const files = readdirSync(cfg.savegameDir)
  .filter((n) => n.toLowerCase().endsWith(".aoe2record"))
  .map((n) => ({ path: join(cfg.savegameDir, n), mtime: statSync(join(cfg.savegameDir, n)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, limit);

const seen = new Map<string, number>();
for (const f of files) {
  console.log(`\n${f.path}`);
  try {
    const h = parseHeader(readFileSync(f.path));
    console.log(`  version ${h.gameVersion} save ${h.saveVersion}, build ${h.build ?? "?"}, ${h.numPlayers} players`);
    for (const p of h.players) {
      if (!p.name && !p.aiName) continue;
      console.log(`  ${p.number}: ${p.name || "(AI: " + p.aiName + ")"}  profile ${p.profileId}`);
      if (p.name) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
    }
  } catch (err) {
    console.log(`  error: ${(err as Error).message}`);
  }
}

const ranked = [...seen.entries()].sort((a, b) => b[1] - a[1]);
if (ranked.length) {
  console.log(`\nmost frequent name: "${ranked[0][0]}" (${ranked[0][1]} of ${files.length} recordings)`);
  console.log(`That is most likely your own name. Put it into config.txt under "playerName".`);
}
