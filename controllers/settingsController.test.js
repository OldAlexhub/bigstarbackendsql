import assert from "node:assert/strict";
import test from "node:test";
import Settings from "../models/Settings.js";
import { settingsResponse } from "./settingsController.js";

test("retention configuration is returned only to ELT settings users", () => {
  const settings = new Settings();
  const ordinaryResponse = settingsResponse(settings);
  const eltResponse = settingsResponse(settings, { includeRetention: true });

  assert.equal(Object.hasOwn(ordinaryResponse, "dataRetention"), false);
  assert.equal(eltResponse.dataRetention.operationalHistory.value, 7);
  assert.equal(eltResponse.dataRetention.networkSubmissionStaging.unit, "years");
  assert.equal(Object.hasOwn(eltResponse, "_id"), false);
});

