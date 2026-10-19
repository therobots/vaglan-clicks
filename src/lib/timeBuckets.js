export const HOUR_MS = 60 * 60 * 1000;

/**
 * Records arrive as zone-less UTC timestamps ("2026-10-19T12:58:14.880000"),
 * so read them as UTC — otherwise the hour pills shift by the visitor's offset.
 */
export const parseTimestamp = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : NaN;
  }
  if (value instanceof Date) return value.getTime();
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  const trimmed = text.replace(/(\.\d{3})\d+/, "$1");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`;
  return Date.parse(zoned);
};

/** Hour block a timestamp belongs to (upload / exif time), as a number key. */
export const hourSlot = (value) => {
  const ms = parseTimestamp(value);
  return Number.isFinite(ms) ? Math.floor(ms / HOUR_MS) : null;
};

export const slotRange = (slot) => {
  if (!Number.isSafeInteger(slot)) throw new TypeError("Hour slot must be a safe integer");
  return {
    start: new Date(slot * HOUR_MS).toISOString(),
    end: new Date((slot + 1) * HOUR_MS).toISOString(),
  };
};

const hourLabel = (hour) => {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
};

/** Chronological hour pills built from the timestamps actually on the shoot. */
export const buildSlots = (timestamps = []) => {
  const unique = [...new Set(timestamps.map(hourSlot).filter((slot) => slot !== null))].sort(
    (a, b) => a - b
  );

  return unique.map((slot) => {
    const hour = new Date(slot * HOUR_MS).getUTCHours();
    return { slot, label: `${hourLabel(hour)} – ${hourLabel(hour + 1)}` };
  });
};