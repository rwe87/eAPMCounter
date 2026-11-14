import assert from "node:assert/strict";
import { test } from "node:test";
import { VERSION, isNewer, parseVersion } from "../src/version.ts";

test("a build from source carries no release version", () => {
  // Nothing replaces the marker outside the build, and that is what switches the
  // update check off while running from a working copy.
  assert.equal(VERSION, "dev");
});

test("parseVersion reads a tag", () => {
  assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion(" v0.1.11 "), [0, 1, 11]);
  assert.equal(parseVersion("dev"), null);
  assert.equal(parseVersion("v1.2"), null);
  assert.equal(parseVersion(""), null);
});

test("isNewer compares the three numbers in order", () => {
  assert.equal(isNewer("v0.1.2", "v0.1.1"), true);
  assert.equal(isNewer("v0.2.0", "v0.1.9"), true);
  assert.equal(isNewer("v1.0.0", "v0.9.9"), true);
  assert.equal(isNewer("v0.1.1", "v0.1.1"), false);
  assert.equal(isNewer("v0.1.0", "v0.1.1"), false);
  // 10 is later than 9, which a text comparison would get wrong.
  assert.equal(isNewer("v0.1.10", "v0.1.9"), true);
});

test("anything unreadable never counts as newer", () => {
  assert.equal(isNewer("v0.9.9", "dev"), false);
  assert.equal(isNewer("latest", "v0.1.1"), false);
  assert.equal(isNewer("", "v0.1.1"), false);
});
