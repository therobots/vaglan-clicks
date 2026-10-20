import { formatMoney } from "@/lib/money";

export default function TipSelector({
  tipCents,
  optionsCents = [0, 100, 200, 300],
  currency = "EUR",
  busy = false,
  onSelect,
}) {
  return (
    <div className="mt-5 border-t border-[#E5E7EB] pt-4">
      <p className="text-[13px] font-bold tracking-tight text-black">
        Buy me a drink?
      </p>
      <div className="mt-2.5 flex gap-1.5">
        {optionsCents.map((amountCents) => {
          const active = tipCents === amountCents;
          const amount = amountCents / 100;
          return (
            <button
              key={amountCents}
              type="button"
              disabled={busy}
              onClick={() => onSelect?.(amountCents)}
              aria-pressed={active}
              className={`flex-1 rounded-full border px-2 py-2 text-[11px] font-bold tracking-tight transition-colors disabled:opacity-50 ${
                active
                  ? "border-neutral-900 bg-neutral-100 text-neutral-900"
                  : "border-gray-200 bg-white text-neutral-600"
              }`}
            >
              {amountCents === 0 ? "No tip" : `+${formatMoney(amount, currency)}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
