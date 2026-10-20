import { TIP_OPTIONS_CENTS } from "./pricing.js";

const storageKey = (token) => `vaglan-order:${token}`;
const cartStorageKey = (cartId) => `vaglan-cart:${cartId}`;

/** @param {"localStorage" | "sessionStorage"} storageName */
const browserStorage = (storageName) => {
  if (typeof window === "undefined") return null;
  try {
    return storageName === "localStorage" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export const readCart = (cartId) => {
  if (typeof cartId !== "string" || !cartId) return { photoIds: [], tipCents: 0 };
  const storage = browserStorage("localStorage");
  if (!storage) return { photoIds: [], tipCents: 0 };
  try {
    const saved = JSON.parse(storage.getItem(cartStorageKey(cartId)) || "[]");
    const ids = Array.isArray(saved) ? saved : saved?.photoIds;
    const tipCents = Number.isSafeInteger(saved?.tipCents) &&
        TIP_OPTIONS_CENTS.includes(saved.tipCents)
      ? saved.tipCents
      : [0, 1, 2, 3].includes(saved?.tip)
        ? saved.tip * 100
        : 0;
    return {
      photoIds: Array.isArray(ids)
        ? [...new Set(ids.filter((id) => typeof id === "string" && id))]
        : [],
      tipCents,
    };
  } catch {
    return { photoIds: [], tipCents: 0 };
  }
};

export const readCartSelection = (cartId) => readCart(cartId).photoIds;
export const readCartTip = (cartId) => readCart(cartId).tipCents;

export const cacheCartSelection = (cartId, photoIds, tipCents = 0) => {
  if (typeof cartId !== "string" || !cartId || !Array.isArray(photoIds)) return;
  const storage = browserStorage("localStorage");
  if (!storage) return;
  try {
    const ids = [...new Set(photoIds.filter((id) => typeof id === "string" && id))];
    if (ids.length) {
      const safeTip = TIP_OPTIONS_CENTS.includes(tipCents) ? tipCents : 0;
      storage.setItem(
        cartStorageKey(cartId),
        JSON.stringify({ photoIds: ids, tipCents: safeTip }),
      );
    }
    else storage.removeItem(cartStorageKey(cartId));
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
