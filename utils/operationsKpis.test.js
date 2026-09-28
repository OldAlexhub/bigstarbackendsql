import test from "node:test";
import assert from "node:assert/strict";
import { addMonths, baseStatus, defaultKpiSetting, monthsBetween, statusWithCritical } from "./operationsKpis.js";

test("month helpers span calendar years and return inclusive periods", () => {
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.deepEqual(monthsBetween("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});

test("status rules support higher and lower is better KPI settings", () => {
  const higher = { enabled: true, direction: "higher", target: 0.97, redCutoff: 0.95 };
  assert.equal(baseStatus(0.98, higher), "green");
  assert.equal(baseStatus(0.96, higher), "yellow");
  assert.equal(baseStatus(0.94, higher), "red");
  assert.equal(statusWithCritical(0.94, higher, "red"), "critical");

  const lower = { enabled: true, direction: "lower", target: 0.75, redCutoff: 0.765 };
  assert.equal(baseStatus(0.7, lower), "green");
  assert.equal(baseStatus(0.76, lower), "yellow");
  assert.equal(baseStatus(0.8, lower), "red");
  assert.equal(baseStatus(null, lower), "no_data");
});

test("default settings isolate GO LINK and seed TPSH at 1.25", () => {
  assert.equal(defaultKpiSetting({ code: "DIV_3_GL" }, "go_link_otp").enabled, true);
  assert.equal(defaultKpiSetting({ code: "DIV_3_GL" }, "otp").enabled, false);
  assert.equal(defaultKpiSetting({ code: "DIV_3" }, "go_link_otp").enabled, false);
  assert.deepEqual(
    { target: defaultKpiSetting({ code: "DIV_5" }, "tpsh").target, redCutoff: defaultKpiSetting({ code: "DIV_5" }, "tpsh").redCutoff },
    { target: 1.25, redCutoff: 1.23 }
  );
});
