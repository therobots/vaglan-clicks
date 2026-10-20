import test from "node:test";
import assert from "node:assert/strict";
import {
  athensHourKey,
  buildSlots,
  formatAthensDateTime,
  formatAthensTime,
  formatNightLabel,
  nightKey,
  parseTimestamp,
} from "../src/lib/timeBuckets.js";

test("parses numeric epoch values and zone-less timestamps as UTC", () => {
  assert.equal(parseTimestamp("1792860014"), 1792860014000);
  assert.equal(
    parseTimestamp("2026-10-24T21:00:00.000000"),
    Date.parse("2026-10-24T21:00:00.000Z"),
  );
});

test("assigns after-midnight captures to the previous Athens night", () => {
  assert.equal(nightKey("2026-10-24T21:40:00Z"), "2026-10-24");
  assert.equal(nightKey("2026-10-24T22:40:00Z"), "2026-10-24");
  assert.equal(formatNightLabel("2026-10-24"), "Sat 24 Oct");
});

test("uses Athens time for captures regardless of the viewer timezone", () => {
  assert.equal(formatAthensTime("2026-10-24T21:00:00Z"), "00:00");
  assert.match(formatAthensDateTime("2026-10-24T21:00:00Z"), /25 Oct 2026, 00:00/);
});

test("keeps Athens spring DST transition times and night keys consistent", () => {
  assert.equal(formatAthensTime("2026-03-29T00:30:00Z"), "02:30");
  assert.equal(formatAthensTime("2026-03-29T01:30:00Z"), "04:30");
  assert.equal(nightKey("2026-03-29T01:30:00Z"), "2026-03-28");
  assert.equal(nightKey("2026-03-29T09:30:00Z"), "2026-03-28");
});

test("disambiguates repeated Athens wall-clock hours during fall DST", () => {
  const beforeTransition = "2026-10-25T00:30:00Z";
  const afterTransition = "2026-10-25T01:30:00Z";
  assert.equal(formatAthensTime(beforeTransition), "03:30");
  assert.equal(formatAthensTime(afterTransition), "03:30");
  assert.notEqual(athensHourKey(beforeTransition), athensHourKey(afterTransition));
  assert.notEqual(formatAthensDateTime(beforeTransition), formatAthensDateTime(afterTransition));
});

test("builds adaptive quarter-hour slots for busy Athens hours", () => {
  const values = Array.from({ length: 31 }, (_, index) =>
    new Date(Date.parse("2026-10-24T20:00:00Z") + index * 60_000).toISOString(),
  );
  const slots = buildSlots(values);
  assert.equal(slots.length, 3);
  assert.ok(slots.every((slot) => slot.slot_minutes === 15));
  assert.deepEqual(
    slots.map((slot) => slot.photo_count).sort((left, right) => left - right),
    [1, 15, 15],
  );
});
