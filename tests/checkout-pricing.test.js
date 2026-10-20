import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  buildCheckoutLineItems,
  calculateSubtotalCents,
  checkoutTotal,
  isAllowedTip,
  selectionSubtotal,
  validateCheckoutSelection,
} from "../src/lib/pricing.js";
import { cacheCartSelection, readCart } from "../src/lib/orderSession.js";

const previousWindow = globalThis.window;

afterEach(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

test("photo subtotal tiers are applied once per order", () => {
  const cases = [
    [1, 200],
    [2, 250],
    [3, 300],
    [10, 650],
  ];

  for (const [count, expectedCents] of cases) {
    assert.equal(calculateSubtotalCents(count, 200, 50), expectedCents);
    assert.equal(selectionSubtotal(count, 2, 0.5), expectedCents / 100);
  }
});

test("Checkout line items match the database total and keep tips separate", () => {
  const result = buildCheckoutLineItems(3, 200, 50, 200);
  assert.deepEqual(result, {
    lineItems: [
      { name: "First photo", quantity: 1, unitAmountCents: 200 },
      { name: "Additional photos", quantity: 2, unitAmountCents: 50 },
      { name: "Tip for @vaglan_clicks", quantity: 1, unitAmountCents: 200 },
    ],
    subtotalCents: 300,
    totalCents: 500,
  });
  assert.equal(checkoutTotal(3, 2, 200, 0.5), 5);
  assert.equal(checkoutTotal(3, 2, 400, 0.5), null);
});

test("checkout rejects invalid tips and tip-only orders", () => {
  const photoIds = ["one-photo"];
  assert.equal(validateCheckoutSelection(photoIds, 0), true);
  assert.equal(validateCheckoutSelection(photoIds, 300), true);
  assert.equal(validateCheckoutSelection(photoIds, 400), false);
  assert.equal(validateCheckoutSelection([], 100), false);
  assert.equal(buildCheckoutLineItems(0, 200, 50, 0), null);
});

test("a three-euro tip persists with selected photos across reloads", () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  globalThis.window = { localStorage: storage };

  cacheCartSelection("public-gallery", ["photo-1"], 300);
  assert.deepEqual(readCart("public-gallery"), {
    photoIds: ["photo-1"],
    tipCents: 300,
  });
});
