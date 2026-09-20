import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG_TEXT, configFromValues, parseConfigText } from "../src/config.ts";

test("config.txt: key = value, comments and blank lines", () => {
  const values = parseConfigText([
    "# comment",
    "",
    "playerName = rOb",
    "port=8200",
    "  timeBase =  real  ",
    "excludedActions = 103, 27,32",
    "noEqualsSign",
    "savegameDir = C:\\path with = sign",
  ].join("\r\n"));
  assert.deepEqual(values, {
    playerName: "rOb",
    port: "8200",
    timeBase: "real",
    excludedActions: "103, 27,32",
    savegameDir: "C:\\path with = sign",
  });
  const cfg = configFromValues(values);
  assert.equal(cfg.port, 8200);
  assert.equal(cfg.timeBase, "real");
  assert.deepEqual(cfg.excludedActions, [103, 27, 32]);
  assert.equal(cfg.windowSeconds, 60);
  assert.equal(cfg.overlayFontSize, "64px");
});

test("the default text yields valid default values", () => {
  const cfg = configFromValues(parseConfigText(DEFAULT_CONFIG_TEXT));
  assert.equal(cfg.port, 8123);
  assert.equal(cfg.playerName, "");
  assert.equal(cfg.timeBase, "game");
  assert.deepEqual(cfg.excludedActions, [103, 27, 32, 15, 10, 53, 255]);
});

test("invalid values produce a readable error", () => {
  assert.throws(() => configFromValues({ port: "abc" }), /"port" must be a number/);
  assert.throws(() => configFromValues({ timeBase: "later" }), /timeBase/);
  assert.throws(() => configFromValues({ excludedActions: "1, x" }), /excludedActions/);
});
