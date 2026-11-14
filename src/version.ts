/**
 * The version this build carries.
 *
 * The build replaces `__EAPM_VERSION__` with the release tag. Running from source
 * leaves it undefined, and the version is then "dev", which switches the update check
 * off: there is nothing sensible to compare a working copy against.
 */
declare const __EAPM_VERSION__: string | undefined;

export const VERSION: string =
  typeof __EAPM_VERSION__ === "string" && __EAPM_VERSION__ ? __EAPM_VERSION__ : "dev";

export const IS_RELEASE_BUILD = VERSION !== "dev";

/** Parses `v1.2.3` into its three numbers. `null` for anything else. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * `true` when `candidate` is a later version than `current`.
 * Anything unparsable counts as "not newer", so a surprise never triggers an update.
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}
