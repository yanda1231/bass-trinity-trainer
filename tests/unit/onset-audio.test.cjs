const assert = require("node:assert/strict");
const test = require("node:test");
const { loadOnsetProcessor } = require("../helpers/index-source.cjs");

function addSyntheticBassPluck(samples, sampleRate, startSeconds) {
  const start = Math.round(startSeconds * sampleRate);
  const length = Math.round(0.09 * sampleRate);
  const frequency = 130.81; // C3: the same note class as the local reference WAVs.
  for (let i = 0; i < length && start + i < samples.length; i += 1) {
    const time = i / sampleRate;
    const attack = Math.min(1, time / 0.003);
    const decay = Math.exp(-time * 35);
    const fundamental = Math.sin(2 * Math.PI * frequency * time);
    const secondHarmonic = 0.35 * Math.sin(2 * Math.PI * frequency * 2 * time);
    samples[start + i] += 0.75 * attack * decay * (fundamental + secondHarmonic);
  }
}

function detect(samples, sampleRate) {
  const { Processor, context } = loadOnsetProcessor(sampleRate);
  const processor = new Processor({ processorOptions: {} });
  for (let frame = 0; frame < samples.length; frame += 128) {
    const block = new Float32Array(128);
    block.set(samples.subarray(frame, frame + block.length));
    context.currentFrame = frame;
    processor.process([[block]]);
  }
  return processor.port.messages.filter(message => message.type === "onset");
}

test("synthetic BPM 200 eighth-note bass plucks are both detected", () => {
  const sampleRate = 44_100;
  const samples = new Float32Array(Math.round(sampleRate * 0.45));
  const firstTime = 0.08;
  const secondTime = firstTime + 60 / 200 / 2;
  addSyntheticBassPluck(samples, sampleRate, firstTime);
  addSyntheticBassPluck(samples, sampleRate, secondTime);

  const onsets = detect(samples, sampleRate);

  assert.equal(onsets.length, 2);
  assert.ok(Math.abs(onsets[0].audioTime - firstTime) < 0.03);
  assert.ok(Math.abs(onsets[1].audioTime - secondTime) < 0.03);
});
