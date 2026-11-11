import React from "react";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/money";

export default function CartBar({
  visible = false,
  count = 0,
  amount = 0,
  currency = "EUR",
  onCheckout,
}) {
  const parsedCount = Number(count);
  const photoCount = Number.isFinite(parsedCount) ? Math.max(0, Math.floor(parsedCount)) : 0;
  const parsedAmount = Number(amount);
  const total = Number.isFinite(parsedAmount) ? Math.max(0, parsedAmount) : 0;
  let safeCurrency = "EUR";
  if (typeof currency === "string" && /^[A-Z]{3}$/.test(currency)) {
    try {
      new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(0);
      safeCurrency = currency;
    } catch {
      safeCurrency = "EUR";
    }
  }
  const canCheckout = visible && photoCount > 0 && typeof onCheckout === "function";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <div
        aria-hidden={!visible}
        className={`pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-gray-200 bg-white py-2 pl-4 pr-2 text-neutral-900 shadow-[0_14px_44px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
          visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-24 opacity-0"
        }`}
      >
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">
            {photoCount} {photoCount === 1 ? "Photo" : "Photos"}
          </p>
          <p className="text-lg font-extrabold leading-tight tracking-tight">
            {formatMoney(total, safeCurrency)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (canCheckout) onCheckout();
          }}
          disabled={!canCheckout}
          className="flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-3 text-[13px] font-bold tracking-tight text-white transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Checkout
          <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
        </button>
      </div>
    </div>
  );
}