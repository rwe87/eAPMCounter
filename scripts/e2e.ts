/**
 * Checks the whole chain without a running game:
 * 1. starts the program against a test folder,
 * 2. writes an old recording into that folder at increased speed,
 * 3. polls /eapm once a second and prints the values,
 * 4. stops once the program has reported the end of the game.
 *
 * Run:  npm run e2e -- [--speed 30] [--port 8124] [--source <file>]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";

const args = process.argv.slice(2);
function opt(name: string, fallback: string): string {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const speed = opt("--speed", "30");
const port = opt("--port", "8124");
const source = opt("--source", "");
const simDir = join(PROJECT_ROOT, ".sim", "savegame");
mkdirSync(simDir, { recursive: true });

function run(script: string, extra: string[], env: NodeJS.ProcessEnv, prefix: string): ChildProcess {
  // Start node directly, not through a shell. Otherwise kill() only hits the shell.
  const child = spawn(process.execPath, ["--import", "tsx", script, ...extra], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const forward = (data: Buffer) => {
    for (const line of data.toString().split(/\r?\n/)) if (line.trim()) console.log(`${prefix} ${line}`);
  };
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  return child;
}

const main = run("src/main.ts", [], { EAPM_SAVEGAME_DIR: simDir, EAPM_PORT: port }, "[main]");
let sim: ChildProcess | null = null;
let sawInGame = false;
let sawEnd = false;
let maxEapm = 0;
let polls = 0;

async function poll(): Promise<void> {
  polls++;
  try {
    const res = await fetch(`http://localhost:${port}/eapm`);
    const s = (await res.json()) as { inGame: boolean; eapm: number | null; gameTimeMs: number; note: string | null };
    if (s.inGame) {
      sawInGame = true;
      if ((s.eapm ?? 0) > maxEapm) maxEapm = s.eapm ?? 0;
      console.log(`[e2e]  in game, game time ${Math.round(s.gameTimeMs / 1000)} s, eAPM ${s.eapm}`);
    } else if (sawInGame) {
      sawEnd = true;
      console.log(`[e2e]  game over (${s.note ?? "end of game read"})`);
    } else {
      console.log(`[e2e]  no game yet (${s.note ?? "waiting"})`);
    }
  } catch (err) {
    console.log(`[e2e]  server not reachable yet: ${(err as Error).message}`);
  }
  if (polls === 3 && !sim) {
    sim = run("scripts/simulate.ts", [...(source ? [source] : []), "--dir", simDir, "--speed", speed], {}, "[sim] ");
  }
  if (sawEnd || polls > 600) finish();
  else setTimeout(poll, 1000);
}

function finish(): void {
  main.kill();
  sim?.kill();
  console.log("");
  console.log(`[e2e]  result: saw a game: ${sawInGame ? "yes" : "no"}, saw the end: ${sawEnd ? "yes" : "no"}, highest eAPM ${maxEapm}`);
  process.exit(sawInGame && sawEnd ? 0 : 1);
}

setTimeout(poll, 1500);
