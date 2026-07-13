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

