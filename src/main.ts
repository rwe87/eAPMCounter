import { CONFIG_PATH, loadConfigFile } from "./config.ts";
import { IS_SEA } from "./paths.ts";
import { guessPlayer } from "./rec/guess.ts";
import { startServer } from "./server.ts";
import { applyPendingUpdate, checkAndStage } from "./update.ts";
import { VERSION } from "./version.ts";
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
  // A version downloaded earlier takes over here, before anything else is opened.
  if (applyPendingUpdate(log)) {
    process.exit(0);
  }

  log(`eAPMCounter ${VERSION}`);

  const { config: cfg, created } = loadConfigFile();
  if (created) log(`settings created: ${CONFIG_PATH}`);
  else log(`settings:     ${CONFIG_PATH}`);

  if (!cfg.playerProfileId && !cfg.playerName) {
    const guess = guessPlayer(cfg.savegameDir);
    if (!guess) {
      fail(`cannot tell who you are. Please set "playerProfileId" or "playerName" in ${CONFIG_PATH}.`);
      return;
    }
    cfg.playerProfileId = guess.profileId;
    cfg.playerName = guess.name;
    log(`you look like "${guess.name}", profile id ${guess.profileId}: that perspective wrote ${guess.hits} of the ${guess.files} newest recordings.`);
    log(`to settle it, put playerProfileId = ${guess.profileId} into ${CONFIG_PATH}.`);
  }

  log(`folder:       ${cfg.savegameDir}`);
  log(`player:       ${cfg.playerName || "(by profile id)"}${cfg.playerProfileId ? `, profile id ${cfg.playerProfileId}` : ""}`);
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

    // Only now, so a slow or unreachable GitHub never delays the overlay.
    if (cfg.autoUpdate) void checkAndStage(log);
    else log("update: switched off in the settings");
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
