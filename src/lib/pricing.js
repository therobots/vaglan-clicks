export const DEFAULT_FIRST_PRICE = 2;
export const EXTRA_PHOTO_PRICE = 0.5;
export const TIP_OPTIONS_CENTS = [0, 100, 200, 300];

export const calculateSubtotalCents = (count, firstPhotoCents, extraPhotoCents) => {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(firstPhotoCents) ||
    firstPhotoCents < 1 ||
    !Number.isSafeInteger(extraPhotoCents) ||
    extraPhotoCents < 0
  ) {
    return null;
  }
  return firstPhotoCents + (count - 1) * extraPhotoCents;
};

export const selectionSubtotal = (
  count,
  firstPrice = DEFAULT_FIRST_PRICE,
  extraPrice = EXTRA_PHOTO_PRICE,
) => {
  const parsedCount = Number(count);
  const first = Number(firstPrice);
  const extra = Number(extraPrice);
  if (!Number.isFinite(parsedCount) || parsedCount <= 0) return 0;
  if (!Number.isFinite(first) || first < 0 || !Number.isFinite(extra) || extra < 0) return 0;
  return first + (Math.floor(parsedCount) - 1) * extra;
};

export const nextPhotoPrice = (
  count,
  firstPrice = DEFAULT_FIRST_PRICE,
  extraPrice = EXTRA_PHOTO_PRICE,
) => (Number(count) <= 0 ? firstPrice : extraPrice);

export const isAllowedTip = (tipCents, options = TIP_OPTIONS_CENTS) =>
  Number.isSafeInteger(tipCents) && options.includes(tipCents);

export const checkoutTotal = (
  count,
  firstPrice,
  tipCents,
  extraPrice = EXTRA_PHOTO_PRICE,
) =>
  Number.isSafeInteger(tipCents) && isAllowedTip(tipCents)
    ? selectionSubtotal(count, firstPrice, extraPrice) + tipCents / 100
    : null;

export const validateCheckoutSelection = (photoIds, tipCents) =>
  Array.isArray(photoIds) &&
  photoIds.length > 0 &&
  photoIds.length <= 100 &&
  isAllowedTip(tipCents);

export const buildCheckoutLineItems = (
  count,
  firstPhotoCents,
  extraPhotoCents,
  tipCents,
) => {
  const subtotalCents = calculateSubtotalCents(count, firstPhotoCents, extraPhotoCents);
  if (subtotalCents === null || !isAllowedTip(tipCents)) return null;
  const lineItems = [
    { name: "First photo", quantity: 1, unitAmountCents: firstPhotoCents },
  ];
  if (count > 1) {
    lineItems.push({
      name: "Additional photos",
      quantity: count - 1,
      unitAmountCents: extraPhotoCents,
    });
  }
  if (tipCents > 0) {
    lineItems.push({
      name: "Tip for @vaglan_clicks",
      quantity: 1,
      unitAmountCents: tipCents,
    });
  }
  return { lineItems, subtotalCents, totalCents: subtotalCents + tipCents };
};