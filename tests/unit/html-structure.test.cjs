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

