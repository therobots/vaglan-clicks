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
    const ids = Array.isArray(saved) ? saved : saved?.photoIds;
    return Array.isArray(ids)
      ? [...new Set(ids.filter((id) => typeof id === "string" && id))]
      : [];
  } catch {
    return [];
  }
};

export const readCartTip = (eventId) => {
  if (typeof eventId !== "string" || !eventId) return 0;
  const storage = browserStorage("localStorage");
  if (!storage) return 0;
  try {
    const saved = JSON.parse(storage.getItem(cartStorageKey(eventId)) || "null");
    return [0, 1, 2, 3].includes(saved?.tip) ? saved.tip : 0;
  } catch {
    return 0;
  }
};

export const cacheCartSelection = (eventId, photoIds, tip = 0) => {
  if (typeof eventId !== "string" || !eventId || !Array.isArray(photoIds)) return;
  const storage = browserStorage("localStorage");
  if (!storage) return;
  try {
    const ids = [...new Set(photoIds.filter((id) => typeof id === "string" && id))];
    if (ids.length) {
      const safeTip = [0, 1, 2, 3].includes(tip) ? tip : 0;
      storage.setItem(cartStorageKey(eventId), JSON.stringify({ photoIds: ids, tip: safeTip }));
    }
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
