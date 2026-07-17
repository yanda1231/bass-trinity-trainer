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

test("Auto Setup measures E-A-D-G in order and waits for silence between strings", () => {
  let now = 1000;
  let timerCallback = null;
  const statuses = [];
  const testModes = [];
  const state = { inputBoostDb: 0, inputLevelDb: -20 };
  const autoSetupState = {
    phase: null,
    noiseFlux: 0.01,
    noiseLevelDb: -80,
    noiseLevels: [],
    stringIndex: 0,
    measurements: [],
    currentFluxes: [],
    currentPeakDb: -100,
    lastHitTime: 0,
    quietSince: 0,
    proposal: null,
    timer: null
  };
  const AUTO_SETUP_TUNING = {
    stringMeasureMs: 1800,
    quietHoldMs: 300,
    hitGateRatio: 4,
    hitRefractoryMs: 400,
    targetPeakDb: -15,
    boostMin: 0,
    boostMax: 24,
    senseHitRatio: 0.45,
    senseNoiseRatio: 3,
    senseMin: 0.01,
    senseMax: 0.6
  };
  const AUTO_SETUP_STRINGS = [
    { number: 4, name: "E" },
    { number: 3, name: "A" },
    { number: 2, name: "D" },
    { number: 1, name: "G" }
  ];
  const context = loadFunctions([
    "median",
    "startAutoSetupString",
    "autoSetupOnFluxPeak",
    "finishAutoSetupString",
    "autoSetupOnInputLevel",
    "finishAutoSetup"
  ], {
    state,
    autoSetupState,
    AUTO_SETUP_TUNING,
    AUTO_SETUP_STRINGS,
    performance: { now: () => now },
    window: {
      setTimeout(callback) {
        timerCallback = callback;
        return 1;
      }
    },
    autoSetupClearTimer() {
      autoSetupState.timer = null;
    },
    sendTestMode(enabled) {
      testModes.push(enabled);
    },
    setAutoSetupStatus(message) {
      statuses.push(message);
    },
    reflectAutoSetupUi() {
    }
  });

  context.startAutoSetupString();
  assert.equal(autoSetupState.phase, "await-string");
  assert.equal(statuses.at(-1), "普段の強さで、いつも通り4弦E（開放弦）を弾いてください");

  context.autoSetupOnFluxPeak(0.5, -18);
  assert.equal(autoSetupState.phase, "measure-string");
  assert.equal(typeof timerCallback, "function");

  now += 500;
  context.autoSetupOnFluxPeak(0.3, -16);
  timerCallback();
  assert.equal(autoSetupState.phase, "wait-quiet");
  assert.equal(statuses.at(-1), "音を止めてください");
  assert.deepEqual(JSON.parse(JSON.stringify(autoSetupState.measurements[0])), {
    number: 4,
    name: "E",
    flux: 0.4,
    peakDb: -16
  });

  state.inputLevelDb = -90;
  now += 1;
  context.autoSetupOnInputLevel(state.inputLevelDb);
  now += 299;
  context.autoSetupOnInputLevel(state.inputLevelDb);
  assert.equal(autoSetupState.stringIndex, 0);
  now += 1;
  context.autoSetupOnInputLevel(state.inputLevelDb);
  assert.equal(autoSetupState.stringIndex, 1);
  assert.equal(autoSetupState.phase, "await-string");
  assert.equal(statuses.at(-1), "普段の強さで、いつも通り3弦A（開放弦）を弾いてください");
  assert.deepEqual(testModes, [true, true]);

  autoSetupState.measurements = [
    { flux: 0.2, peakDb: -20 },
    { flux: 0.1, peakDb: -10 },
    { flux: 0.3, peakDb: -14 },
    { flux: 0.4, peakDb: -12 }
  ];
  context.finishAutoSetup();
  assert.deepEqual(JSON.parse(JSON.stringify(autoSetupState.proposal)), { boostDb: 0, sense: 0.05 });
  assert.equal(statuses.at(-1), "提案: Boost +0dB / Sense 0.05 →");
});
