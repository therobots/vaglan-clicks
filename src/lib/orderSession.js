const storageKey = (token) => `vaglan-order:${token}`;

export const cacheOrder = (order, photos) => {
  try {
    sessionStorage.setItem(storageKey(order.session_token), JSON.stringify({ order, photos }));
  } catch {
    // Private mode / quota — the entity store is the source of truth.
  }
};

export const readCachedOrder = (token) => {
  if (!token) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(token));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
