import assert from "node:assert/strict";
import test from "node:test";
import { parseInclusiveDateRange } from "./dateRange.js";

test("inclusive date ranges use the following midnight as the exclusive upper bound", () => {
  const range = parseInclusiveDateRange("2026-09-01", "2026-09-09");

  assert.equal(range.error, undefined);
  assert.equal(range.fromInclusive.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(range.toExclusive.toISOString(), "2026-09-10T00:00:00.000Z");
  assert.equal(new Date("2026-09-09T23:59:59.999Z") < range.toExclusive, true);
  assert.equal(new Date("2026-09-10T00:00:00.000Z") < range.toExclusive, false);
});

test("inclusive date ranges support a single selected day", () => {
  const range = parseInclusiveDateRange("2028-02-29", "2028-02-29");

  assert.equal(range.fromInclusive.toISOString(), "2028-02-29T00:00:00.000Z");
  assert.equal(range.toExclusive.toISOString(), "2028-03-01T00:00:00.000Z");
});

test("inclusive date ranges reject invalid and reversed dates", () => {
  assert.match(parseInclusiveDateRange("2026-02-30", "2026-03-01").error, /from/);
  assert.match(parseInclusiveDateRange("09/01/2026", "2026-09-09").error, /YYYY-MM-DD/);
  assert.equal(
    parseInclusiveDateRange("2026-09-10", "2026-09-09").error,
    "from must be on or before to"
  );
});
