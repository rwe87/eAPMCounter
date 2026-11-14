/**
 * Computes the average eAPM of the own player over a whole recording and shows how
 * often each action type occurred. For comparison with CaptureAge or aoe2insights.
 *
 * Run:  npm run stats            (newest 5)
 *       npm run stats -- 10      (newest 10)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { actionName } from "../src/rec/actions.ts";
import { BodyParser } from "../src/rec/body.ts";
import { findPlayerByProfileId, findPlayerNumber, parseHeader } from "../src/rec/header.ts";

const cfg = loadConfig();
const limit = Number(process.argv[2] ?? 5);
const excluded = new Set(cfg.excludedActions);

const files = readdirSync(cfg.savegameDir)
  .filter((n) => n.toLowerCase().endsWith(".aoe2record"))
  .map((n) => join(cfg.savegameDir, n))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  .slice(0, limit);

for (const path of files) {
  const data = readFileSync(path);
  let header;
  try {
    header = parseHeader(data);
  } catch (err) {
    console.log(`\n${basename(path)}\n  header not readable: ${(err as Error).message}`);
    continue;
  }
  const me = findPlayerByProfileId(header.players, cfg.playerProfileId) ?? findPlayerNumber(header.players, cfg.playerName);
  const parser = new BodyParser({ fileOffset: header.bodyOffset });
  const events = parser.feed(data.subarray(header.bodyOffset));

  const perPlayer = new Map<number, number>();
  const perType = new Map<string, number>();
  let counted = 0;
  for (const ev of events) {
    if (ev.kind !== "action") continue;
    if (excluded.has(ev.actionId)) continue;
    perPlayer.set(ev.playerId, (perPlayer.get(ev.playerId) ?? 0) + 1);
    if (ev.playerId === me) {
      counted++;
      const name = actionName(ev.actionId);
      perType.set(name, (perType.get(name) ?? 0) + 1);
    }
  }
  const minutes = parser.gameTimeMs / 60_000;
  console.log(`\n${basename(path)}`);
  console.log(`  game time ${minutes.toFixed(1)} min, end of game read: ${parser.finished ? "yes" : "no"}`);
  for (const p of header.players) {
    if (!p.name && !p.aiName) continue;
    const n = perPlayer.get(p.number) ?? 0;
    const mark = p.number === me ? "  <- me" : "";
    console.log(`  ${p.number}: ${(p.name || "AI " + p.aiName).padEnd(24)} ${String(n).padStart(5)} actions  ${(n / minutes).toFixed(1).padStart(6)} eAPM${mark}`);
  }
  if (me === null) {
    console.log(`  you do not appear in this recording.`);
    continue;
  }
  const top = [...perType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`  own actions by type: ${top.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  own total: ${counted}`);
}
