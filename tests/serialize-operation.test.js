import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeOperation } from "../com.ulanzi.monitortoggle.ulanziPlugin/plugin/serialize-operation.js";

test("toggles do not overlap and a failed operation does not block the next", async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const events = [];
  const run = serializeOperation(async id => {
    events.push(`start ${id}`);
    if (id === 1) { await held; throw new Error("display failure"); }
    events.push(`end ${id}`);
    return id;
  });
  const first = run(1);
  const rejection = assert.rejects(first, /display failure/);
  const second = run(2);
  await Promise.resolve();
  assert.deepEqual(events, ["start 1"]);
  release();
  await rejection;
  assert.equal(await second, 2);
  assert.deepEqual(events, ["start 1", "start 2", "end 2"]);
});
