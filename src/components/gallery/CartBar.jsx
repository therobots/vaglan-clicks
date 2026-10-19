import React from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/money";

export default function CartBar({ count, amount, currency, onCheckout }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <motion.div
        initial={{ y: 96, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 96, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-black py-2 pl-4 pr-2 text-white shadow-[0_14px_44px_rgba(0,0,0,0.3)]"
      >
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/50">
            {count} {count === 1 ? "Photo" : "Photos"}
          </p>
          <p className="text-lg font-extrabold leading-tight tracking-tight">
            {formatMoney(amount, currency)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCheckout}
          className="flex items-center gap-2 rounded-xl bg-[#0055FF] px-5 py-3 text-[13px] font-bold tracking-tight transition-transform active:scale-[0.97]"
        >
          Checkout
          <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
        </button>
      </motion.div>
    </div>
  );
}