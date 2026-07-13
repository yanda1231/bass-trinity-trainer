const assert = require("node:assert/strict");
const test = require("node:test");
const { loadFunctions } = require("../helpers/index-source.cjs");

test("Average, Median and SD keep their current definitions", () => {
  const context = loadFunctions(["mean", "median", "sd"]);

  assert.equal(context.mean([]), 0);
  assert.equal(context.mean([10, 20, 30]), 20);
  assert.equal(context.median([9, 1, 5]), 5);
  assert.equal(context.median([1, 9, 3, 7]), 5);
  assert.equal(context.sd([0, 10]), 5);
});

test("Just includes the exact Judge Window boundary", () => {
  const state = { judgeWindow: 20 };
  const context = loadFunctions(["mean", "median", "sd", "statsFromHits"], { state });
  const result = context.statsFromHits([
    { kind: "hit", ms: -20 },
    { kind: "hit", ms: 20 },
    { kind: "hit", ms: -20.1 },
    { kind: "hit", ms: 20.1 },
    { kind: "ghost", ms: 0 }
  ]);

  assert.equal(result.hits, 4);
  assert.equal(result.just, 2);
  assert.equal(result.justRate, 0.5);
  assert.equal(result.early, 1);
  assert.equal(result.late, 1);
  assert.equal(result.med, 0);
});

test("Hit matching ignores used notes and rejects distant sounds", () => {
  const state = {
    tempo: 120,
    scheduledNotes: [
      { time: 1, hit: true, id: "used" },
      { time: 1.1, hit: false, id: "available" }
    ]
  };
  const context = loadFunctions(["beatDuration", "nearestScheduled"], { state });

  assert.equal(context.nearestScheduled(1.2).expected.id, "available");
  assert.equal(context.nearestScheduled(1.33), null);
});

