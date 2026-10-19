export const HOUR_MS = 60 * 60 * 1000;
export const SLOT_MS = 30 * 60 * 1000;

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

/** Thirty-minute UTC slot containing an upload timestamp. */
export const hourSlot = (value) => {
  const ms = parseTimestamp(value);
  return Number.isFinite(ms) ? Math.floor(ms / SLOT_MS) : null;
};

export const slotRange = (slot) => {
  if (!Number.isSafeInteger(slot)) throw new TypeError("Hour slot must be a safe integer");
  return {
    start: new Date(slot * SLOT_MS).toISOString(),
    end: new Date((slot + 1) * SLOT_MS).toISOString(),
  };
};

const localTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** Display UTC time slots in the partygoer's local time zone. */
export const buildSlots = (timestamps = []) => {
  const unique = [...new Set(timestamps.map(hourSlot).filter((slot) => slot !== null))].sort(
    (a, b) => a - b
  );

  return unique.map((slot) => ({
    slot,
    label: `${localTime.format(new Date(slot * SLOT_MS))} - ${localTime.format(
      new Date((slot + 1) * SLOT_MS)
    )}`,
  }));
};