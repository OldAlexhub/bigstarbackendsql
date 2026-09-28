import assert from "node:assert/strict";
import test from "node:test";
import Settings from "./Settings.js";

test("OSR advance days defaults to the seven-day policy limit", () => {
  const settings = new Settings();
  assert.equal(settings.osrAdvanceDays, 7);
});

test("OSR advance days accepts only values from zero through seven", async () => {
  await new Settings({ osrAdvanceDays: 0 }).validate();
  await new Settings({ osrAdvanceDays: 7 }).validate();
  await assert.rejects(new Settings({ osrAdvanceDays: 2.5 }).validate(), /whole number/);
  await assert.rejects(new Settings({ osrAdvanceDays: 8 }).validate(), /maximum allowed value/);
  await assert.rejects(new Settings({ osrAdvanceDays: -1 }).validate(), /minimum allowed value/);
});

test("Schedule History lookback weeks defaults to six", () => {
  const settings = new Settings();
  assert.equal(settings.scheduleHistoryLookbackWeeks, 6);
});

test("Schedule History lookback weeks accepts only values from one through twelve", async () => {
  await new Settings({ scheduleHistoryLookbackWeeks: 1 }).validate();
  await new Settings({ scheduleHistoryLookbackWeeks: 12 }).validate();
  await assert.rejects(new Settings({ scheduleHistoryLookbackWeeks: 5.5 }).validate(), /whole number/);
  await assert.rejects(new Settings({ scheduleHistoryLookbackWeeks: 13 }).validate(), /maximum allowed value/);
  await assert.rejects(new Settings({ scheduleHistoryLookbackWeeks: 0 }).validate(), /minimum allowed value/);
});

test("data retention defaults are conservative and disabled until ELT enables them", () => {
  const settings = new Settings();
  assert.equal(settings.dataRetention.enabled, false);
  assert.equal(settings.dataRetention.operationalHistory.value, 7);
  assert.equal(settings.dataRetention.operationalHistory.unit, "years");
  assert.equal(settings.dataRetention.auditLogs.value, 7);
  assert.equal(settings.dataRetention.auditLogs.unit, "years");
  assert.equal(settings.dataRetention.teamPosts.value, 3);
  assert.equal(settings.dataRetention.teamPosts.unit, "years");
  assert.equal(settings.dataRetention.networkSubmissionStaging.value, 1);
  assert.equal(settings.dataRetention.networkSubmissionStaging.unit, "years");
});

test("retention periods support days, months, years, and retaining indefinitely", async () => {
  const settings = new Settings();
  settings.dataRetention.operationalHistory = { value: 30, unit: "days" };
  settings.dataRetention.auditLogs = { value: 18, unit: "months" };
  settings.dataRetention.teamPosts = { value: 2, unit: "years" };
  settings.dataRetention.networkSubmissionStaging = { value: 1, unit: "indefinite" };
  await settings.validate();
});
