import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";

const STATES = {
  live: { label: "Live Syncing", dot: "bg-[#10B981]", pulse: true },
  uploading: { label: "Uploading Shot...", dot: "bg-[#0055FF]", pulse: false },
  offline: { label: "Offline", dot: "bg-[#EF4444]", pulse: false },
};

export default function LiveStatusPill({ state = "offline" }) {
  const { label, dot, pulse } = STATES[state] || STATES.offline;

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1">
      {state === "uploading" ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#0055FF]" strokeWidth={3} />
      ) : (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          {pulse && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-75" />
          )}
          <span
            className={`relative inline-flex h-1.5 w-1.5 rounded-full transition-colors duration-300 ${dot}`}
          />
        </span>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.08em] text-black"
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}