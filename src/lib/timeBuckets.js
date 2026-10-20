export const HOUR_MS = 60 * 60 * 1000;
export const SLOT_MS = 30 * 60 * 1000;
export const ATHENS_TIME_ZONE = "Europe/Athens";

const athensHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: ATHENS_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});
const athensTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: ATHENS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const athensDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: ATHENS_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "shortOffset",
  hourCycle: "h23",
});
const nightDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const localHourKeyFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ATHENS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  timeZoneName: "shortOffset",
  hourCycle: "h23",
});

/** Parse numeric epoch seconds/milliseconds and ISO timestamps as UTC. */
export const parseTimestamp = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : NaN;
  }
  if (value instanceof Date) return value.getTime();
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    const numericValue = Number(text);
    return Number.isFinite(numericValue)
      ? numericValue < 1e12
        ? numericValue * 1000
        : numericValue
      : NaN;
  }
  const trimmed = text.replace(/(\.\d{3})\d+/, "$1");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
  return Date.parse(zoned);
};

const datePartsInAthens = (milliseconds) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATHENS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(milliseconds));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

/** Athens local date for the timestamp twelve hours before the capture. */
export const nightKey = (value) => {
  const milliseconds = parseTimestamp(value);
  return Number.isFinite(milliseconds)
    ? datePartsInAthens(milliseconds - 12 * HOUR_MS)
    : null;
};

export const formatNightLabel = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : nightDateFormatter.format(date).replace(",", "");
};

export const formatAthensTime = (value) => {
  const milliseconds = parseTimestamp(value);
  return Number.isFinite(milliseconds) ? athensTime.format(new Date(milliseconds)) : "";
};

export const formatAthensDateTime = (value) => {
  const milliseconds = parseTimestamp(value);
  return Number.isFinite(milliseconds) ? athensDateTime.format(new Date(milliseconds)) : "";
};

export const formatAthensHour = (value) => {
  const milliseconds = parseTimestamp(value);
  return Number.isFinite(milliseconds) ? athensHour.format(new Date(milliseconds)) : "";
};

export const athensHourKey = (value) => {
  const milliseconds = parseTimestamp(value);
  if (!Number.isFinite(milliseconds)) return null;
  return localHourKeyFormatter
    .formatToParts(new Date(milliseconds))
    .filter(({ type }) => type !== "literal")
    .map(({ type, value: part }) => `${type}:${part}`)
    .join("|");
};

/** Adaptive Athens-time slots for client-held timestamp lists. */
export const buildSlots = (timestamps = []) => {
  const parsed = timestamps
    .map((value) => ({ milliseconds: parseTimestamp(value), key: athensHourKey(value) }))
    .filter(({ milliseconds, key }) => Number.isFinite(milliseconds) && key);
  const countsByHour = new Map();
  for (const { key } of parsed) countsByHour.set(key, (countsByHour.get(key) || 0) + 1);

  const groups = new Map();
  for (const photo of parsed) {
    const hourCount = countsByHour.get(photo.key);
    const slotMinutes = hourCount > 30 ? 15 : hourCount > 10 ? 30 : 60;
    const durationMs = slotMinutes * 60 * 1000;
    const startMs = Math.floor(photo.milliseconds / durationMs) * durationMs;
    const key = `${slotMinutes}:${startMs}`;
    const group = groups.get(key) || { startMs, slotMinutes, photoCount: 0 };
    group.photoCount += 1;
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((left, right) => right.startMs - left.startMs)
    .map(({ startMs, slotMinutes, photoCount }) => ({
      slot: startMs,
      slot_start: new Date(startMs).toISOString(),
      slot_end: new Date(startMs + slotMinutes * 60 * 1000).toISOString(),
      slot_minutes: slotMinutes,
      photo_count: photoCount,
      label: `${formatAthensTime(startMs)}–${formatAthensTime(
        startMs + slotMinutes * 60 * 1000,
      )}`,
    }));
};

/** Map server-aggregated slots into the same UI shape as buildSlots. */
export const mapGallerySlots = (slots = []) =>
  slots.map((slot) => ({
    ...slot,
    slot: parseTimestamp(slot.slot_start),
    label: `${formatAthensTime(slot.slot_start)}–${formatAthensTime(slot.slot_end)}`,
  }));
