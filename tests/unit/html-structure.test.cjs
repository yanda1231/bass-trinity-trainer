const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { readIndex } = require("../helpers/index-source.cjs");

test("index.html has valid main-script syntax and no duplicate element IDs", () => {
  const html = readIndex();
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(script => script.trim());

  assert.deepEqual(duplicates, []);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: "index-inline.js" }));
});

test("the main controls required for the published app are present", () => {
  const html = readIndex();
  for (const id of [
    "startTimingBtn",
    "tempoInput",
    "simpleModeBtn",
    "helpBtn",
    "historyBtnLive",
    "audioInputToggleBtn",
    "onsetTestBtn",
    "loopbackCalBtn"
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `Missing required control: ${id}`);
  }
});

test("the onset processor is separated from index.html and loaded from its stable path", () => {
  const html = readIndex();
  assert.doesNotMatch(html, /ONSET_WORKLET_CODE/);
  assert.match(html, /new URL\("src\/onset-processor\.js", document\.baseURI\)/);
});

test("fresh settings consistently present Refract as 80 ms", () => {
  const html = readIndex();
  assert.match(html, /id="refractoryInput"[^>]*value="80"/);
  assert.match(html, /id="refractoryValue">80 ms</);
  assert.equal((html.match(/refractoryMs: 80/g) || []).length, 2);
});
