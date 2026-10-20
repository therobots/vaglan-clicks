import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { formatMoney } from "@/lib/money";

export default function CheckoutSheet({
  open,
  count,
  amount,
  currency,
  busy,
  payError = "",
  onClose,
  onPay = null,
  checkoutEnabled = false,
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canPay = checkoutEnabled && typeof onPay === "function" && !busy;

  useEffect(() => {
    if (!open) {
      setError("");
    }
  }, [open]);

  const submit = (e) => {
    e.preventDefault();
    if (!checkoutEnabled || typeof onPay !== "function") {
      setError("Secure checkout is not configured. No payment was made.");
      return;
    }
    if (!valid) {
      setError("Enter an email we can send your backup links to.");
      return;
    }
    setError("");
    onPay(email.trim());
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
                  {count} {count === 1 ? "photo" : "photos"} · {formatMoney(amount, currency)}
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

            <label htmlFor="checkout-email" className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-black/60">
              Email for backup links
            </label>
            <input
              id="checkout-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              disabled={!canPay}
              className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5 text-[15px] text-black outline-none transition-colors focus:border-black disabled:opacity-60"
            />
            {(error || payError) && (
              <p className="mt-2 text-[12px] font-medium text-red-600">{error || payError}</p>
            )}

            <div className="mt-4 border-t border-[#E5E7EB] pt-4">
              <div className="flex items-center justify-between text-[13px] font-semibold text-black/60">
                <span>
                  {count} {count === 1 ? "photo" : "photos"}
                </span>
                <span>{formatMoney(amount, currency)}</span>
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
                  ? `Pay ${formatMoney(amount, currency)}`
                  : "Checkout unavailable"}
            </button>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-black/40">
              {checkoutEnabled
                ? "Payment is handled securely by the configured payment provider."
                : "Secure checkout is not configured. No payment will be taken."}
            </p>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );
}