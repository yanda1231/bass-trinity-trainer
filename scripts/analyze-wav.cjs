const fs = require("node:fs");
const path = require("node:path");
const { loadOnsetProcessor } = require("../tests/helpers/index-source.cjs");

function readPcm16MonoWav(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("WAV file is not RIFF/WAVE");
  }

  let offset = 12;
  let format = null;
  let pcm = null;
  while (offset + 8 <= data.length) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: data.readUInt16LE(start),
        channels: data.readUInt16LE(start + 2),
        sampleRate: data.readUInt32LE(start + 4),
        bitsPerSample: data.readUInt16LE(start + 14)
      };
    }
    if (id === "data") pcm = data.subarray(start, start + size);
    offset = start + size + (size % 2);
  }

  if (!format || !pcm) throw new Error("WAV is missing fmt or data chunk");
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error("Only mono 16-bit PCM WAV files are supported");
  }

  const samples = new Float32Array(pcm.length / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  return { ...format, samples };
}

function analyze(filePath) {
  const wav = readPcm16MonoWav(filePath);
  // These downloaded fixtures are long, sustained single notes. The onset detector's
  // spectral analysis is intentionally expensive, so the attack section is enough for
  // this local diagnostic. This is not used as a CI pass/fail assertion.
  const analysisSamples = Math.min(wav.samples.length, Math.round(wav.sampleRate * 2));
  const { Processor, context } = loadOnsetProcessor(wav.sampleRate);
  const processor = new Processor({
    processorOptions: {
      frameSize: 1024,
      hopSize: 256,
      threshold: 0.08,
      refractoryMs: 50,
      silenceGateDb: -70,
      adaptivePre: 8,
      adaptivePost: 1
    }
  });

  for (let frame = 0; frame < analysisSamples; frame += 128) {
    const block = new Float32Array(128);
    block.set(wav.samples.subarray(frame, Math.min(analysisSamples, frame + block.length)));
    context.currentFrame = frame;
    processor.process([[block]]);
  }

  const onsets = processor.port.messages.filter(message => message.type === "onset");
  return {
    file: path.basename(filePath),
    sampleRate: wav.sampleRate,
    durationSeconds: wav.samples.length / wav.sampleRate,
    analyzedSeconds: analysisSamples / wav.sampleRate,
    onsetCount: onsets.length,
    onsetTimesSeconds: onsets.map(message => Number(message.audioTime.toFixed(4)))
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  process.stderr.write("Usage: npm run analyze:wav -- <file.wav> [more.wav]\n");
  process.exitCode = 1;
} else {
  for (const file of files) process.stdout.write(`${JSON.stringify(analyze(path.resolve(file)), null, 2)}\n`);
}
