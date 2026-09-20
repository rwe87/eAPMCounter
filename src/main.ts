import { CONFIG_PATH, loadConfigFile } from "./config.ts";
import { IS_SEA } from "./paths.ts";
import { guessPlayerName } from "./rec/guess.ts";
import { startServer } from "./server.ts";
import { RecWatcher } from "./watcher.ts";

function stamp(): string {
  return new Date().toLocaleTimeString();
}

const log = (msg: string) => console.log(`[${stamp()}] ${msg}`);

/** As an EXE the window stays open after an error, so the message can be read. */
function fail(msg: string): never {
  console.error("");
  console.error(`ERROR: ${msg}`);
  if (IS_SEA) {
    console.error("");
    console.error("Press Enter to close this window.");
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(1));
    return undefined as never;
  }
  process.exit(1);
}

function main(): void {
  const { config: cfg, created } = loadConfigFile();
  if (created) log(`settings created: ${CONFIG_PATH}`);
  else log(`settings:     ${CONFIG_PATH}`);

  if (!cfg.playerName) {
    const guess = guessPlayerName(cfg.savegameDir);
    if (!guess) {
      fail(`no player name known. Please set "playerName" in ${CONFIG_PATH}.`);
      return;
    }
    cfg.playerName = guess.name;
    log(`player name guessed: "${guess.name}" (in ${guess.hits} of ${guess.files} recordings). Set it in ${CONFIG_PATH}.`);
  }

  log(`folder:       ${cfg.savegameDir}`);
  log(`player:       ${cfg.playerName}`);
  log(`time window:  ${cfg.windowSeconds} s (${cfg.timeBase === "game" ? "game time" : "wall clock"})`);

  const watcher = new RecWatcher(cfg, log);
  let lastShown: number | null = null;
  watcher.on("game-end", () => {
    lastShown = null;
  });
  watcher.start();

  const server = startServer(cfg, () => watcher.state);
  server.on("error", (err: NodeJS.ErrnoException) => {
    watcher.stop();
    if (err.code === "EADDRINUSE") {
      fail(`port ${cfg.port} is already in use. Is the program already running? Otherwise change "port" in ${CONFIG_PATH}.`);
    } else {
      fail(`server could not start: ${err.message}`);
    }
  });
  server.on("listening", () => {
    log(`status page:  http://localhost:${cfg.port}/`);
    log(`OBS browser source URL: http://localhost:${cfg.port}/overlay`);
    log("running. Close the window or press Ctrl+C to stop.");
  });

  setInterval(() => {
    const s = watcher.state;
    if (!s.inGame) return;
    if (s.eapm !== lastShown) {
      lastShown = s.eapm;
      log(`eAPM ${s.eapm ?? "-"}  (game time ${Math.round(s.gameTimeMs / 1000)} s, counted ${s.totalCounted})`);
    }
  }, 1000);

  const shutdown = (): void => {
    watcher.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

try {
  main();
} catch (err) {
  fail((err as Error).message);
}
