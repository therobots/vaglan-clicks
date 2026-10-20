import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { formatMoney } from "@/lib/money";
import TipSelector from "@/components/gallery/TipSelector";
import { galleryText, useGalleryLanguage } from "@/lib/galleryLanguage";

export default function CheckoutSheet({
  open,
  count,
  subtotal,
  tipCents,
  tipOptionsCents,
  total,
  currency,
  busy,
  payError = "",
  onClose,
  onTipChange,
  onPay = null,
  checkoutEnabled = false,
}) {
  const language = useGalleryLanguage();
  const text = galleryText[language];
  const canPay = checkoutEnabled && count > 0 && typeof onPay === "function" && !busy;

  const submit = (e) => {
    e.preventDefault();
    if (!checkoutEnabled || typeof onPay !== "function") {
      return;
    }
    onPay();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={busy ? undefined : onClose}
            className="absolute inset-0 bg-black/40"
          />
          <motion.form
            onSubmit={submit}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="relative z-10 w-full max-w-md rounded-t-3xl bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5"
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-black tracking-tight text-black">Checkout</h2>
                <p className="mt-0.5 text-[13px] text-black/50">
                  {count} {count === 1 ? "photo" : "photos"} · {formatMoney(total, currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="grid h-8 w-8 place-items-center rounded-full bg-black/5 text-black disabled:opacity-40"
                aria-label="Close checkout"
              >
                <X className="h-4 w-4" strokeWidth={2.4} />
              </button>
            </div>

            <TipSelector
              tipCents={tipCents}
              optionsCents={tipOptionsCents}
              currency={currency}
              busy={busy}
              onSelect={onTipChange}
            />

            {payError && (
              <p role="alert" className="mt-3 text-[12px] font-medium text-red-600">{payError}</p>
            )}

            <div className="mt-4 border-t border-[#E5E7EB] pt-4">
              <div className="flex items-center justify-between text-[13px] font-semibold text-black/60">
                <span>
                  {count} {count === 1 ? "photo" : "photos"}
                </span>
                <span>{formatMoney(subtotal, currency)}</span>
              </div>
              {tipCents > 0 && (
                <div className="mt-1.5 flex items-center justify-between text-[13px] font-semibold text-black/60">
                  <span>Tip for @vaglan_clicks</span>
                  <span>+{formatMoney(tipCents / 100, currency)}</span>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-[#E5E7EB] pt-3">
                <span className="text-[13px] font-semibold text-black/60">Total</span>
                <span className="text-xl font-black tracking-tight text-black">
                  {formatMoney(total, currency)}
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={!canPay}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0055FF] py-4 text-[15px] font-bold text-white transition-transform active:scale-[0.99] disabled:opacity-70"
            >
              {busy
                ? "Opening secure checkout…"
                : canPay
                  ? `Pay ${formatMoney(total, currency)}`
                  : "Checkout unavailable"}
            </button>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-black/40">
              {checkoutEnabled
                ? "Stripe will securely collect your email for the download receipt."
                : "Secure checkout is not configured. No payment will be taken."}
            </p>
            <a href="/info" className="mt-3 block text-center text-xs font-semibold underline">
              {text.orderInfo}
            </a>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );
}