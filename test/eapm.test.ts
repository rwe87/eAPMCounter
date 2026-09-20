import assert from "node:assert/strict";
import { test } from "node:test";
import { EapmCounter } from "../src/eapm.ts";

test("counts actions inside a 60 s window", () => {
  const c = new EapmCounter(60_000);
  c.markStart(0);
  for (let t = 1000; t <= 120_000; t += 1000) c.add(t); // one action per second
  assert.equal(c.value(120_000), 60);
  assert.equal(c.value(120_000), 60); // a second call changes nothing
});

test("drops actions that fall out of the window", () => {
  const c = new EapmCounter(60_000);
  c.markStart(0);
  for (let t = 1000; t <= 30_000; t += 1000) c.add(t); // 30 actions in the first half minute
  assert.equal(c.value(60_000), 30);
  assert.equal(c.value(90_000), 0);
});

test("scales to the elapsed time during the first minute", () => {
  const c = new EapmCounter(60_000, 10_000);
  c.markStart(0);
  for (let t = 1000; t <= 30_000; t += 1000) c.add(t);
  assert.equal(c.value(30_000), 60); // 30 actions in 30 s
});

test("scaling starts at 10 s, before that 10 s counts as the elapsed time", () => {
  const c = new EapmCounter(60_000, 10_000);
  c.markStart(0);
  c.add(500);
  c.add(1000);
  assert.equal(c.value(2000), 12); // 2 actions, scaled to 10 s
});

test("reset clears everything", () => {
  const c = new EapmCounter(60_000);
  c.add(5000);
  c.reset();
  c.markStart(100_000);
  assert.equal(c.value(160_000), 0);
});
