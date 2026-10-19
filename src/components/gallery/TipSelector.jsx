import React from "react";
import { formatMoney } from "@/lib/money";

const TIPS = [0, 1, 2, 3];

export default function TipSelector({ tip, currency, busy, onSelect }) {
  return (
    <div className="mt-5 border-t border-[#E5E7EB] pt-4">
      <p className="text-[13px] font-bold tracking-tight text-black">
        Buy @vaglan_clicks a drink? 🍺
      </p>
      <div className="mt-2.5 flex gap-1.5">
        {TIPS.map((amount) => {
          const active = tip === amount;
          return (
            <button
              key={amount}
              type="button"
              disabled={busy}
              onClick={() => onSelect(amount)}
              className={`flex-1 rounded-full border px-2 py-2 text-[11px] font-bold tracking-tight transition-colors disabled:opacity-50 ${
                active
                  ? "border-neutral-900 bg-neutral-100 text-neutral-900"
                  : "border-gray-200 bg-white text-neutral-600"
              }`}
            >
              {amount === 0 ? "No tip" : `+${formatMoney(amount, currency)}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}