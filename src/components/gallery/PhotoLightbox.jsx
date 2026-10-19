import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Image } from "@/components/ui/image";
import Watermark from "@/components/gallery/Watermark";
import { formatMoney } from "@/lib/money";

export default function PhotoLightbox({
  photo,
  selected,
  price,
  currency,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onToggle,
  onClose,
}) {
  const [direction, setDirection] = useState(1);

  const go = (delta) => {
    if (delta > 0 && !hasNext) return;
    if (delta < 0 && !hasPrev) return;
    setDirection(delta);
    if (delta > 0) onNext();
    else onPrev();
  };

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onNext, onPrev, onClose]);

  const handleDragEnd = (_, info) => {
    const power = info.offset.x + info.velocity.x * 0.15;
    if (power < -70) go(1);
    else if (power > 70) go(-1);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="fixed inset-0 z-50 flex flex-col bg-white"
    >
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <span className="truncate pr-3 text-[11px] font-bold uppercase tracking-[0.1em] text-black/35">
          {photo.filename || "Preview"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/5 text-black active:scale-90"
        >
          <X className="h-4 w-4" strokeWidth={2.6} />
        </button>
      </div>

      <div className="relative mx-4 mb-4 flex-1 overflow-hidden rounded-2xl bg-neutral-100">
        <AnimatePresence initial={false}>
          <motion.div
            key={photo.id}
            initial={{ x: direction * 70, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction * -70, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.14}
            onDragEnd={handleDragEnd}
            className="absolute inset-0 touch-pan-y"
          >
            <div className="relative h-full w-full select-none">
              <Image
                src={photo.preview_url}
                alt={photo.filename || "Event photo preview"}
                fittingType="fit"
                className="absolute inset-0 h-full w-full"
              />
              <Watermark large />
            </div>
          </motion.div>
        </AnimatePresence>

        <button
          type="button"
          onClick={() => go(-1)}
          disabled={!hasPrev}
          aria-label="Previous photo"
          className="absolute left-2 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[#E5E7EB] bg-white/90 text-black shadow-sm backdrop-blur transition-opacity active:scale-90 disabled:opacity-25"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={!hasNext}
          aria-label="Next photo"
          className="absolute right-2 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[#E5E7EB] bg-white/90 text-black shadow-sm backdrop-blur transition-opacity active:scale-90 disabled:opacity-25"
        >
          <ChevronRight className="h-5 w-5" strokeWidth={2.4} />
        </button>
      </div>

      <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <button
          type="button"
          onClick={onToggle}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-bold transition-transform active:scale-[0.99] ${
            selected ? "border border-[#E5E7EB] bg-white text-black" : "bg-[#0055FF] text-white"
          }`}
        >
          {selected ? (
            <>
              <Check className="h-4 w-4" strokeWidth={3} />
              Remove from Selection
            </>
          ) : (
            `Select Photo for ${formatMoney(price, currency)}`
          )}
        </button>
      </div>
    </motion.div>
  );
}