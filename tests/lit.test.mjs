import test from "node:test";
import assert from "node:assert";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collect } from "../build/lit.mjs";

test("reads literals without running anything", () => {
  const f = join(mkdtempSync(join(tmpdir(), "lit")), "x.js");
  writeFileSync(f, 'globalThis.ran = true; var A = {b: ["x" + "y", -1]}; window.C = [{d: 1}];');
  const o = collect(f);
  assert.deepStrictEqual(o.A, { b: ["xy", -1] });
  assert.deepStrictEqual(o["window.C"], [{ d: 1 }]);
  assert.strictEqual(globalThis.ran, undefined);
});
