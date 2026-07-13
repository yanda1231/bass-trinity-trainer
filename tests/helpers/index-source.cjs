const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../..");
const INDEX_PATH = path.join(ROOT, "index.html");
const WORKLET_PATH = path.join(ROOT, "src/onset-processor.js");

function readIndex() {
  return fs.readFileSync(INDEX_PATH, "utf8");
}

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Function not found in index.html: ${name}`);

  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function in index.html: ${name}`);
}

function extractWorkletCode() {
  return fs.readFileSync(WORKLET_PATH, "utf8");
}

function loadFunctions(names, globals = {}) {
  const source = readIndex();
  const context = vm.createContext({ Math, ...globals });
  const declarations = names.map(name => extractFunction(source, name)).join("\n");
  vm.runInContext(declarations, context, { filename: "index-functions.js" });
  return context;
}

function loadOnsetProcessor(sampleRate = 44_100) {
  let Processor = null;

  class AudioWorkletProcessor {
    constructor() {
      const messages = [];
      this.port = {
        messages,
        onmessage: null,
        postMessage(message) {
          messages.push(message);
        }
      };
    }
  }

  const context = vm.createContext({
    AudioWorkletProcessor,
    Float32Array,
    Math,
    currentFrame: 0,
    sampleRate,
    registerProcessor(name, implementation) {
      if (name !== "btt-onset-processor") throw new Error(`Unexpected processor: ${name}`);
      Processor = implementation;
    }
  });

  vm.runInContext(extractWorkletCode(), context, { filename: "btt-onset-processor.js" });
  if (!Processor) throw new Error("AudioWorklet processor was not registered");
  return { Processor, context };
}

module.exports = {
  INDEX_PATH,
  ROOT,
  WORKLET_PATH,
  extractFunction,
  extractWorkletCode,
  loadFunctions,
  loadOnsetProcessor,
  readIndex
};
