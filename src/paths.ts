/**
 * Where settings and overlay files live.
 *
 * As an EXE (Node's Single Executable Application) the overlay files sit inside the EXE
 * and the settings next to it. When started through tsx, everything is in the project
 * folder.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAsset, isSea } from "node:sea";
import { fileURLToPath } from "node:url";

export const IS_SEA = isSea();

function projectRoot(): string {
  const url = (import.meta as { url?: string }).url;
  if (url && url.startsWith("file:")) return resolve(dirname(fileURLToPath(url)), "..");
  return process.cwd();
}

/** Folder holding config.txt: next to the EXE, or the project folder. */
export const BASE_DIR = IS_SEA ? dirname(process.execPath) : projectRoot();

/** Folder holding the overlay files when started through tsx. */
const ASSET_DIR = join(projectRoot(), "overlay");

export const ASSET_NAMES = ["overlay.html", "overlay.css", "overlay.js"] as const;
export type AssetName = (typeof ASSET_NAMES)[number];

/** Reads an overlay file: from inside the EXE, or from the overlay folder. */
export function readAsset(name: AssetName): string {
  if (IS_SEA) return getAsset(name, "utf8");
  return readFileSync(join(ASSET_DIR, name), "utf8");
}
