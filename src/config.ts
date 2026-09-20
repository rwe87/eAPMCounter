/**
 * Settings from config.txt. One line per setting: `key = value`.
 * Lines starting with # are comments. When the file is missing, it is created with
 * the default values.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BASE_DIR } from "./paths.ts";
import { DEFAULT_EXCLUDED_ACTIONS } from "./rec/actions.ts";

export interface Config {
  /** Folder where the game stores its recordings. */
  savegameDir: string;
  /** Own name in the game. Empty: guessed from the recent recordings. */
  playerName: string;
  /** Port of the local HTTP server. */
  port: number;
  /** Length of the time window in seconds. */
  windowSeconds: number;
  /** "game": game time from the recording. "real": wall clock time. */
  timeBase: "game" | "real";
  /** How often the file is checked, in milliseconds. */
  pollMs: number;
  /** After this many seconds without the file growing, the game counts as over. */
  idleSeconds: number;
  /** Action types that are not counted. */
  excludedActions: number[];
  /** Font size of the number in the overlay, for example "64px". */
  overlayFontSize: string;
  /** Color of the number in the overlay, for example "#ffffff". */
  overlayColor: string;
}

export const PROJECT_ROOT = BASE_DIR;
export const CONFIG_PATH = join(BASE_DIR, "config.txt");

const DEFAULTS: Config = {
  savegameDir: "",
  playerName: "",
  port: 8123,
  windowSeconds: 60,
  timeBase: "game",
  pollMs: 250,
  idleSeconds: 180,
  excludedActions: DEFAULT_EXCLUDED_ACTIONS,
  overlayFontSize: "64px",
  overlayColor: "#ffffff",
};

export const DEFAULT_CONFIG_TEXT = `# eAPMCounter settings
# One line per setting: key = value. Lines starting with # are comments.
# Restart the program after a change.

# Own name in the game. Leave empty to let the program take the name that appears
# most often in the recent recordings and print it at startup.
playerName = ${DEFAULTS.playerName}

# Port of the local server. The overlay page is at http://localhost:<port>/overlay
port = ${DEFAULTS.port}

# Length of the time window in seconds.
windowSeconds = ${DEFAULTS.windowSeconds}

# game = game time like CaptureAge, real = wall clock time.
timeBase = ${DEFAULTS.timeBase}

# Folder holding the .aoe2record files. Leave empty to search automatically under
# C:\\Users\\<name>\\Games\\Age of Empires 2 DE\\<Steam ID>\\savegame
savegameDir = ${DEFAULTS.savegameDir}

# How often the file is checked, in milliseconds.
pollMs = ${DEFAULTS.pollMs}

# After this many seconds without the file growing, the game counts as over.
idleSeconds = ${DEFAULTS.idleSeconds}

# Action types that are not counted (ids from the recording, separated by commas).
# 103 game settings, 27 save, 32 chapter marker, 15 spectate,
# 10 and 53 AI commands, 255 end of game.
excludedActions = ${DEFAULTS.excludedActions.join(", ")}

# Look of the number in the overlay. Reload the browser source in OBS after a change.
overlayFontSize = ${DEFAULTS.overlayFontSize}
overlayColor = ${DEFAULTS.overlayColor}
`;

/** Splits the text of config.txt into keys and values. */
export function parseConfigText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Looks for the savegame folder under `%USERPROFILE%\Games\Age of Empires 2 DE\<Steam ID>\savegame`.
 * With several profile folders, the one with the newest recording wins.
 */
export function findDefaultSavegameDir(): string | null {
  const base = join(homedir(), "Games", "Age of Empires 2 DE");
  if (!existsSync(base)) return null;
  let best: { dir: string; mtime: number } | null = null;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || entry.name === "0") continue;
    const dir = join(base, entry.name, "savegame");
    if (!existsSync(dir)) continue;
    let newest = 0;
    for (const f of readdirSync(dir)) {
      if (!f.toLowerCase().endsWith(".aoe2record")) continue;
      const m = statSync(join(dir, f)).mtimeMs;
      if (m > newest) newest = m;
    }
    if (!best || newest > best.mtime) best = { dir, mtime: newest };
  }
  return best?.dir ?? null;
}

function num(values: Record<string, string>, key: string, fallback: number): number {
  const raw = values[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`setting "${key}" must be a number, not "${raw}"`);
  return n;
}

export function configFromValues(values: Record<string, string>): Config {
  const timeBase = (values.timeBase || DEFAULTS.timeBase).toLowerCase();
  if (timeBase !== "game" && timeBase !== "real") {
    throw new Error(`setting "timeBase" must be game or real, not "${values.timeBase}"`);
  }
  const excluded = values.excludedActions === undefined || values.excludedActions === ""
    ? DEFAULTS.excludedActions
    : values.excludedActions.split(/[,\s;]+/).filter(Boolean).map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n)) throw new Error(`setting "excludedActions" contains "${s}", which is not a number`);
        return n;
      });
  return {
    savegameDir: values.savegameDir || "",
    playerName: values.playerName || "",
    port: num(values, "port", DEFAULTS.port),
    windowSeconds: num(values, "windowSeconds", DEFAULTS.windowSeconds),
    timeBase,
    pollMs: num(values, "pollMs", DEFAULTS.pollMs),
    idleSeconds: num(values, "idleSeconds", DEFAULTS.idleSeconds),
    excludedActions: excluded,
    overlayFontSize: values.overlayFontSize || DEFAULTS.overlayFontSize,
    overlayColor: values.overlayColor || DEFAULTS.overlayColor,
  };
}

export interface LoadResult {
  config: Config;
  /** `true` when the file was just created with the default values. */
  created: boolean;
}

export function loadConfigFile(path: string = CONFIG_PATH): LoadResult {
  let created = false;
  if (!existsSync(path)) {
    writeFileSync(path, DEFAULT_CONFIG_TEXT, "utf8");
    created = true;
  }
  const cfg = configFromValues(parseConfigText(readFileSync(path, "utf8")));

  if (process.env.EAPM_SAVEGAME_DIR) cfg.savegameDir = process.env.EAPM_SAVEGAME_DIR;
  if (process.env.EAPM_PORT) cfg.port = Number(process.env.EAPM_PORT);
  if (!cfg.savegameDir) {
    const found = findDefaultSavegameDir();
    if (!found) {
      throw new Error(`no savegame folder found. Please set "savegameDir" in ${path}.`);
    }
    cfg.savegameDir = found;
  }
  if (!existsSync(cfg.savegameDir)) {
    throw new Error(`the folder "${cfg.savegameDir}" does not exist. Please check "savegameDir" in ${path}.`);
  }
  return { config: cfg, created };
}

export function loadConfig(path: string = CONFIG_PATH): Config {
  return loadConfigFile(path).config;
}
