import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDropIndex } from "./settings.js";

// Moving `id` from `from` to the resolved index must reproduce the expected
// order; this locks the table's "meaning" column, not just the bare number.
function movedOrder(from, target, insertAfter) {
  const order = ["A", "B", "C", "D"];
  const index = resolveDropIndex(from, target, insertAfter);
  const [moved] = order.splice(from, 1);
  order.splice(index, 0, moved);
  return { index, order };
}

const cases = [
  { from: 0, target: 2, insertAfter: false, expected: 1, order: ["B", "A", "C", "D"] },
  { from: 0, target: 2, insertAfter: true, expected: 2, order: ["B", "C", "A", "D"] },
  { from: 3, target: 1, insertAfter: false, expected: 1, order: ["A", "D", "B", "C"] },
  { from: 3, target: 1, insertAfter: true, expected: 2, order: ["A", "B", "D", "C"] },
  { from: 1, target: 2, insertAfter: false, expected: 1, order: ["A", "B", "C", "D"] },
  { from: 2, target: 1, insertAfter: true, expected: 2, order: ["A", "B", "C", "D"] },
  { from: 0, target: 3, insertAfter: true, expected: 3, order: ["B", "C", "D", "A"] },
  { from: 3, target: 0, insertAfter: false, expected: 0, order: ["D", "A", "B", "C"] },
];

describe("resolveDropIndex", () => {
  for (const { from, target, insertAfter, expected, order } of cases) {
    it(`from=${from} target=${target} insertAfter=${insertAfter} -> ${expected}`, () => {
      assert.equal(resolveDropIndex(from, target, insertAfter), expected);
      assert.deepEqual(movedOrder(from, target, insertAfter).order, order);
    });
  }
});
