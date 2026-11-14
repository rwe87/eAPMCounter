/**
 * Keeps the EXE up to date with the releases on GitHub.
 *
 * Windows refuses to overwrite a running program, but it does allow renaming one. The
 * update therefore happens in two halves:
 *
 * 1. While running, a newer EXE is downloaded and parked next to the current one as
 *    `eAPMCounter.exe.new`. Nothing in the running program changes.
 * 2. At the next start, the current EXE is renamed to `.old`, the parked one takes its
 *    place, and the new one is started. The old file is deleted the start after that.
 *
 * So an update never takes effect in the middle of a stream, only between two starts.
 *
 * The download is checked against the SHA-256 the release publishes. A file that does
 * not match is thrown away and nothing is parked.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { IS_SEA } from "./paths.ts";
import { IS_RELEASE_BUILD, VERSION, isNewer } from "./version.ts";

const REPO = "rwe87/eAPMCounter";
const RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const EXE_ASSET = "eAPMCounter.exe";
const HASH_ASSET = "eAPMCounter.exe.sha256";
/** Nothing here is worth making the user wait for. */
const TIMEOUT_MS = 30_000;

export type Logger = (msg: string) => void;

function exePaths() {
  const exe = process.execPath;
  return { exe, staged: exe + ".new", old: exe + ".old", dir: dirname(exe) };
}

/**
 * Puts a parked update in place and starts it, then reports that this process should
 * stop. Call this first thing, before anything else is opened.
 *
 * Returns `true` when the caller must exit immediately: the replacement is already
 * running.
 */
export function applyPendingUpdate(log: Logger): boolean {
  if (!IS_SEA) return false;
  const { exe, staged, old } = exePaths();

  // Left over from the previous swap. Deleting it may fail while the old process is
  // still shutting down, and that is fine: the next start tries again.
  if (existsSync(old)) {
    try {
      rmSync(old, { force: true });
    } catch {
      /* try again next time */
    }
  }

  if (!existsSync(staged)) return false;

  try {
    renameSync(exe, old);
  } catch (err) {
    log(`update: cannot move the running program aside: ${(err as Error).message}`);
    return false;
  }
  try {
    renameSync(staged, exe);
  } catch (err) {
    // Put it back, otherwise there is no program left at the expected path.
    try {
      renameSync(old, exe);
    } catch {
      /* nothing left to try */
    }
    log(`update: cannot put the new version in place: ${(err as Error).message}`);
    return false;
  }

  log("update: new version in place, starting it");
  const child = spawn(exe, process.argv.slice(1), {
    cwd: process.cwd(),
    detached: true,
    stdio: "inherit",
  });
  child.unref();
  return true;
}

interface Release {
  tag: string;
  exeUrl: string;
  hashUrl: string;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "eAPMCounter" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function latestRelease(): Promise<Release | null> {
  const data = (await getJson(RELEASE_URL)) as {
    tag_name?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  const tag = data.tag_name;
  const assets = data.assets ?? [];
  const exe = assets.find((a) => a.name === EXE_ASSET);
  const hash = assets.find((a) => a.name === HASH_ASSET);
  if (!tag || !exe || !hash) return null;
  return { tag, exeUrl: exe.browser_download_url, hashUrl: hash.browser_download_url };
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": "eAPMCounter" },
    signal: AbortSignal.timeout(TIMEOUT_MS * 10),
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Looks for a newer release and parks it. Never throws: a failed check is a line in the
 * log, not a reason to stop counting.
 *
 * Returns the tag that was parked, or `null`.
 */
export async function checkAndStage(log: Logger): Promise<string | null> {
  if (!IS_SEA || !IS_RELEASE_BUILD) return null;
  try {
    const release = await latestRelease();
    if (!release) {
      log("update: the newest release carries no file to update from");
      return null;
    }
    if (!isNewer(release.tag, VERSION)) {
      log(`update: ${VERSION} is current`);
      return null;
    }

    log(`update: ${release.tag} is available, downloading`);
    const [exeBytes, hashText] = await Promise.all([
      download(release.exeUrl),
      download(release.hashUrl).then((b) => b.toString("utf8")),
    ]);

    const expected = /[0-9a-f]{64}/i.exec(hashText)?.[0]?.toLowerCase();
    if (!expected) {
      log("update: the release publishes no readable checksum, not installing");
      return null;
    }
    const actual = createHash("sha256").update(exeBytes).digest("hex");
    if (actual !== expected) {
      log("update: the download does not match the published checksum, thrown away");
      return null;
    }

    const { staged } = exePaths();
    writeFileSync(staged, exeBytes);
    log(`update: ${release.tag} is ready and starts the next time you open ${basename(process.execPath)}`);
    return release.tag;
  } catch (err) {
    log(`update: check failed, carrying on: ${(err as Error).message}`);
    return null;
  }
}

/** Whether an update is parked and waiting for a restart. */
export function stagedUpdateExists(): boolean {
  return IS_SEA && existsSync(exePaths().staged);
}

export const UPDATE_REPO_URL = `https://github.com/${REPO}/releases/latest`;
