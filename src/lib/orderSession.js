const storageKey = (token) => `vaglan-order:${token}`;
const cartStorageKey = (eventId) => `vaglan-cart:${eventId}`;

/** @param {"localStorage" | "sessionStorage"} storageName */
const browserStorage = (storageName) => {
  if (typeof window === "undefined") return null;
  try {
    return storageName === "localStorage" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export const readCartSelection = (eventId) => {
  if (typeof eventId !== "string" || !eventId) return [];
  const storage = browserStorage("localStorage");
  if (!storage) return [];
  try {
    const saved = JSON.parse(storage.getItem(cartStorageKey(eventId)) || "[]");
    return Array.isArray(saved)
      ? [...new Set(saved.filter((id) => typeof id === "string" && id))]
      : [];
  } catch {
    return [];
  }
};

export const cacheCartSelection = (eventId, photoIds) => {
  if (typeof eventId !== "string" || !eventId || !Array.isArray(photoIds)) return;
  const storage = browserStorage("localStorage");
  if (!storage) return;
  try {
    const ids = [...new Set(photoIds.filter((id) => typeof id === "string" && id))];
    if (ids.length) storage.setItem(cartStorageKey(eventId), JSON.stringify(ids));
    else storage.removeItem(cartStorageKey(eventId));
  } catch {
    // The current page cart remains usable when browser storage is unavailable.
  }
};

export const cacheOrder = (order, photos) => {
  if (!order?.session_token) return;
  try {
    browserStorage("sessionStorage")?.setItem(
      storageKey(order.session_token),
      JSON.stringify({ order, photos: Array.isArray(photos) ? photos : [] })
    );
  } catch {
    // Private mode / quota — the entity store is the source of truth.
  }
};

export const readCachedOrder = (token) => {
  if (!token) return null;
  try {
    const raw = browserStorage("sessionStorage")?.getItem(storageKey(token));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
