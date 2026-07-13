class BttOnsetProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = (options && options.processorOptions) || {};
    this.frameSize = p.frameSize || 1024;
    this.hopSize = p.hopSize || 256;
    this.threshold = p.threshold || 0.08;
    this.refractoryMs = p.refractoryMs || 80;
    this.silenceGateDb = p.silenceGateDb || -70;
    this.adaptivePre = p.adaptivePre || 8;
    this.adaptivePost = p.adaptivePost || 1;
    this.overloadThreshold = Math.pow(10, -3 / 20);
    this.overloadSamples = 0;
    this.overloadLatched = false;
    this.calMode = false;
    this.calFloor = 1e-6;
    this.testMode = false;
    this.testFluxPeak = 0;
    this.testSamples = 0;
    this.frame = new Float32Array(this.frameSize);
    this.window = new Float32Array(this.frameSize);
    this.prevMag = new Float32Array(Math.min(160, this.frameSize / 2));
    this.fluxHistory = [];
    this.pending = [];
    this.write = 0;
    this.samplesSinceHop = 0;
    this.lastOnsetFrame = -Infinity;
    for (let i = 0; i < this.frameSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.max(1, this.frameSize - 1));
    }
    this.port.onmessage = event => {
      const data = event.data || {};
      if (data.type === "params") {
        if (typeof data.threshold === "number") this.threshold = data.threshold;
        if (typeof data.refractoryMs === "number") this.refractoryMs = data.refractoryMs;
        if (typeof data.silenceGateDb === "number") this.silenceGateDb = data.silenceGateDb;
        if (typeof data.adaptivePre === "number") this.adaptivePre = data.adaptivePre;
        if (typeof data.adaptivePost === "number") this.adaptivePost = data.adaptivePost;
      }
      if (data.type === "reset-overload") {
        this.overloadSamples = 0;
        this.overloadLatched = false;
      }
      if (data.type === "cal-mode") {
        this.calMode = !!data.enabled;
        if (!this.calMode) this.calFloor = 1e-6;
      }
      if (data.type === "test-mode") {
        this.testMode = !!data.enabled;
        this.testFluxPeak = 0;
        this.testSamples = 0;
      }
    };
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let blockSum = 0;
    let blockPeak = 0;
    for (let i = 0; i < input.length; i++) {
      const sample = input[i] || 0;
      blockSum += sample * sample;
      const amp = sample < 0 ? -sample : sample;
      if (amp > blockPeak) blockPeak = amp;
      this.frame[this.write] = sample;
      this.write = (this.write + 1) % this.frameSize;
      this.samplesSinceHop += 1;
      if (this.samplesSinceHop >= this.hopSize) {
        this.samplesSinceHop = 0;
        if (!this.calMode) this.analyse(currentFrame + i);
      }
    }
    if (this.calMode) this.detectCalOnset(input, blockPeak, currentFrame);
    const rms = Math.sqrt(blockSum / input.length);
    if (rms > this.overloadThreshold) {
      this.overloadSamples += input.length;
    } else {
      this.overloadSamples = Math.max(0, this.overloadSamples - input.length * 2);
    }
    if (!this.overloadLatched && this.overloadSamples >= sampleRate * 0.25) {
      this.overloadLatched = true;
      this.port.postMessage({ type: "overload" });
    }
    if (this.testMode && !this.calMode) {
      this.testSamples += input.length;
      if (this.testSamples >= sampleRate * 0.2) {
        this.port.postMessage({ type: "flux-peak", value: this.testFluxPeak });
        this.testFluxPeak = 0;
        this.testSamples = 0;
      }
    }
    return true;
  }

  detectCalOnset(input, blockPeak, blockStartFrame) {
    this.calFloor = Math.max(this.calFloor * 0.999, 1e-6);
    if (blockPeak < this.calFloor * 4) {
      this.calFloor = this.calFloor * 0.95 + blockPeak * 0.05;
    }
    const absMin = Math.pow(10, -65 / 20);
    const relThresh = this.calFloor * 8;
    if (blockPeak > relThresh && blockPeak > absMin) {
      const crossThresh = Math.max(relThresh, absMin);
      let idx = 0;
      for (let i = 0; i < input.length; i++) {
        const amp = input[i] < 0 ? -input[i] : input[i];
        if (amp > crossThresh) { idx = i; break; }
      }
      const onsetFrame = blockStartFrame + idx;
      const refractoryFrames = sampleRate * this.refractoryMs / 1000;
      if (onsetFrame - this.lastOnsetFrame >= refractoryFrames) {
        this.lastOnsetFrame = onsetFrame;
        this.port.postMessage({
          type: "onset",
          audioTime: onsetFrame / sampleRate,
          flux: blockPeak,
          db: 20 * Math.log10(Math.max(blockPeak, 0.000001))
        });
      }
    }
  }

  analyse(frameEnd) {
    const ordered = new Float32Array(this.frameSize);
    let sum = 0;
    for (let i = 0; i < this.frameSize; i++) {
      const sample = this.frame[(this.write + i) % this.frameSize];
      ordered[i] = sample * this.window[i];
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.frameSize);
    const db = 20 * Math.log10(Math.max(rms, 0.000001));
    const flux = db < this.silenceGateDb ? 0 : this.spectralFlux(ordered);
    if (this.testMode && flux > this.testFluxPeak) this.testFluxPeak = flux;
    const item = { flux, db, frameEnd };
    this.fluxHistory.push(flux);
    this.pending.push(item);
    const keep = this.adaptivePre + this.adaptivePost + 8;
    if (this.fluxHistory.length > keep) this.fluxHistory.shift();
    if (this.pending.length > this.adaptivePost) {
      const candidate = this.pending.shift();
      this.pickPeak(candidate);
    }
  }

  spectralFlux(frame) {
    const bins = this.prevMag.length;
    let flux = 0;
    for (let k = 0; k < bins; k++) {
      let re = 0;
      let im = 0;
      const phaseStep = -2 * Math.PI * k / this.frameSize;
      for (let n = 0; n < this.frameSize; n++) {
        const phase = phaseStep * n;
        re += frame[n] * Math.cos(phase);
        im += frame[n] * Math.sin(phase);
      }
      const mag = Math.sqrt(re * re + im * im) / this.frameSize;
      const diff = mag - this.prevMag[k];
      if (diff > 0) flux += diff;
      this.prevMag[k] = mag;
    }
    return flux / bins * 100;
  }

  pickPeak(candidate) {
    const values = this.fluxHistory.slice(-Math.max(1, this.adaptivePre + this.adaptivePost + 1)).sort((a, b) => a - b);
    const median = values.length ? values[Math.floor(values.length / 2)] : 0;
    const adaptive = median * 1.5 + this.threshold;
    const refractoryFrames = sampleRate * this.refractoryMs / 1000;
    const sinceLast = candidate.frameEnd - this.lastOnsetFrame;
    if (candidate.flux >= adaptive && sinceLast >= refractoryFrames) {
      this.lastOnsetFrame = candidate.frameEnd;
      // Report the start of the causal hop block. The previous formula was
      // 512 samples (~11.6 ms at 44.1 kHz) early for the default settings.
      const onsetFrame = Math.max(0, candidate.frameEnd - this.hopSize);
      this.port.postMessage({
        type: "onset",
        audioTime: onsetFrame / sampleRate,
        flux: candidate.flux,
        db: candidate.db
      });
    }
  }
}

registerProcessor("btt-onset-processor", BttOnsetProcessor);
