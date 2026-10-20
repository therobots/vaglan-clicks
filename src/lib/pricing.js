export const DEFAULT_PHOTO_PRICE = 3;

export const photoPrice = (price) => {
  const parsedPrice = Number(price);
  return Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : DEFAULT_PHOTO_PRICE;
};

export const selectionSubtotal = (count, unitPrice) => {
  const parsedCount = Number(count);
  if (!Number.isFinite(parsedCount) || parsedCount <= 0) return 0;
  return Math.floor(parsedCount) * photoPrice(unitPrice);
};

export const nextPhotoPrice = (_count, unitPrice) => photoPrice(unitPrice);