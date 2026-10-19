/**
 * Pricing: the first photo of a selection costs the shoot's price
 * (Event.price_per_photo), every extra photo in the same order is a flat add-on.
 */
export const EXTRA_PHOTO_PRICE = 0.5;
export const DEFAULT_FIRST_PRICE = 2;

export const firstPhotoPrice = (event) =>
  Number(event?.price_per_photo ?? DEFAULT_FIRST_PRICE);

export const selectionSubtotal = (count, firstPrice) =>
  count <= 0 ? 0 : firstPrice + (count - 1) * EXTRA_PHOTO_PRICE;

export const nextPhotoPrice = (count, firstPrice) =>
  count <= 0 ? firstPrice : EXTRA_PHOTO_PRICE;