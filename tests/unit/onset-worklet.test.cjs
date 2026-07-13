const assert = require("node:assert/strict");
const test = require("node:test");
const { loadOnsetProcessor } = require("../helpers/index-source.cjs");

for (const sampleRate of [44_100, 48_000]) {
  test(`onset timestamp regression stays sample-based at ${sampleRate} Hz`, () => {
    const { Processor } = loadOnsetProcessor(sampleRate);
    const processor = new Processor({ processorOptions: { frameSize: 1024, hopSize: 256 } });
    processor.fluxHistory = [0, 0, 0];

    processor.pickPeak({ flux: 1, db: -12, frameEnd: 2048 });

    const onset = processor.port.messages.find(message => message.type === "onset");
    const expectedFrame = 2048 - 256;
    const oldIncorrectFrame = 2048 - 1024 + 256;
    assert.ok(onset);
    assert.equal(onset.audioTime, expectedFrame / sampleRate);
    assert.equal(expectedFrame - oldIncorrectFrame, 512);
  });
}

test("calibration reports the exact threshold-crossing sample", () => {
  const sampleRate = 44_100;
  const { Processor } = loadOnsetProcessor(sampleRate);
  const processor = new Processor({ processorOptions: {} });
  const input = new Float32Array(128);
  input[37] = 0.1;

  processor.detectCalOnset(input, 0.1, 1024);

  const onset = processor.port.messages.find(message => message.type === "onset");
  assert.ok(onset);
  assert.equal(onset.audioTime, (1024 + 37) / sampleRate);
});

test("the default 80 ms Refract suppresses a 64 ms duplicate candidate", () => {
  const sampleRate = 44_100;
  const { Processor } = loadOnsetProcessor(sampleRate);
  const processor = new Processor({ processorOptions: {} });
  const firstFrame = 4096;
  processor.fluxHistory = [0, 0, 0];

  processor.pickPeak({ flux: 1, db: -12, frameEnd: firstFrame });
  processor.pickPeak({ flux: 1, db: -12, frameEnd: firstFrame + Math.round(sampleRate * 0.064) });

  assert.equal(processor.refractoryMs, 80);
  assert.equal(processor.port.messages.filter(message => message.type === "onset").length, 1);
});

test("the default 80 ms Refract still accepts BPM 200 eighth notes", () => {
  const sampleRate = 48_000;
  const { Processor } = loadOnsetProcessor(sampleRate);
  const processor = new Processor({ processorOptions: {} });
  const firstFrame = 4096;
  const eighthNoteAtBpm200 = 60 / 200 / 2;
  processor.fluxHistory = [0, 0, 0];

  processor.pickPeak({ flux: 1, db: -12, frameEnd: firstFrame });
  processor.pickPeak({ flux: 1, db: -12, frameEnd: firstFrame + sampleRate * eighthNoteAtBpm200 });

  assert.equal(eighthNoteAtBpm200, 0.15);
  assert.equal(processor.port.messages.filter(message => message.type === "onset").length, 2);
});

test("sustained overload is latched once", () => {
  const sampleRate = 44_100;
  const { Processor, context } = loadOnsetProcessor(sampleRate);
  const processor = new Processor({ processorOptions: {} });
  const input = new Float32Array(128).fill(0.9);
  processor.calMode = true;

  for (let frame = 0; frame < sampleRate * 0.35; frame += input.length) {
    context.currentFrame = frame;
    processor.process([[input]]);
  }

  const overloads = processor.port.messages.filter(message => message.type === "overload");
  assert.equal(overloads.length, 1);
});
