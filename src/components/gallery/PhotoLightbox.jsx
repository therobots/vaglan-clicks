import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import Watermark from "@/components/gallery/Watermark";
import { formatMoney } from "@/lib/money";
import { galleryText, useGalleryLanguage } from "@/lib/galleryLanguage";

export default function PhotoLightbox({
  photo,
  capturedAt = "",
  selected,
  isFree = false,
  isDownloading = false,
  downloadError = "",
  price,
  currency,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onToggle,
  onDownloadFree,
  onRequestRemoval,
  onClose,
}) {
  const language = useGalleryLanguage();
  const text = galleryText[language];
  const [direction, setDirection] = useState(1);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const viewportRef = useRef(null);
  const touchRef = useRef({
    startX: 0,
    startY: 0,
    deltaX: 0,
    deltaY: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    pinchDistance: 0,
    isZoomGesture: false,
  });

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

  useEffect(() => {
    setZoom({ scale: 1, x: 0, y: 0 });
  }, [photo.id]);

  const handleTouchStart = (event) => {
    const touches = event.touches;
    if (!touches.length) return;
    const firstTouch = touches[0];
    const currentZoom = zoom;
    touchRef.current = {
      startX: firstTouch.clientX,
      startY: firstTouch.clientY,
      deltaX: 0,
      deltaY: 0,
      scale: currentZoom.scale,
      offsetX: currentZoom.x,
      offsetY: currentZoom.y,
      pinchDistance:
        touches.length > 1
          ? Math.hypot(
              touches[0].clientX - touches[1].clientX,
              touches[0].clientY - touches[1].clientY,
            )
          : 0,
      isZoomGesture: touches.length > 1 || currentZoom.scale > 1,
    };
  };

  const handleTouchMove = (event) => {
    const touches = event.touches;
    const touchState = touchRef.current;
    if (!touches.length) return;

    if (touches.length > 1) {
      touchState.isZoomGesture = true;
      const distance = Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );
      const pinchDistance = touchState.pinchDistance || distance;
      const scale = Math.min(3, Math.max(1, touchState.scale * (distance / pinchDistance)));
      const nextZoom = scale === 1 ? { scale, x: 0, y: 0 } : { ...zoom, scale };
      setZoom(nextZoom);
      return;
    }

    const touch = touches[0];
    const deltaX = touch.clientX - touchState.startX;
    const deltaY = touch.clientY - touchState.startY;
    touchState.deltaX = deltaX;
    touchState.deltaY = deltaY;

    if (touchState.scale <= 1) return;

    const viewport = viewportRef.current;
    const maxOffsetX = viewport ? ((touchState.scale - 1) * viewport.clientWidth) / 2 : 0;
    const maxOffsetY = viewport ? ((touchState.scale - 1) * viewport.clientHeight) / 2 : 0;
    setZoom({
      scale: touchState.scale,
      x: Math.min(maxOffsetX, Math.max(-maxOffsetX, touchState.offsetX + deltaX)),
      y: Math.min(maxOffsetY, Math.max(-maxOffsetY, touchState.offsetY + deltaY)),
    });
  };

  const handleTouchEnd = (event) => {
    const touchState = touchRef.current;
    if (event.touches.length === 1 && zoom.scale > 1) {
      const remainingTouch = event.touches[0];
      touchState.startX = remainingTouch.clientX;
      touchState.startY = remainingTouch.clientY;
      touchState.deltaX = 0;
      touchState.deltaY = 0;
      touchState.scale = zoom.scale;
      touchState.offsetX = zoom.x;
      touchState.offsetY = zoom.y;
      touchState.isZoomGesture = true;
      return;
    }
    if (touchState.isZoomGesture || touchState.scale > 1) return;
    if (Math.abs(touchState.deltaX) < 50) return;
    if (Math.abs(touchState.deltaX) < Math.abs(touchState.deltaY)) return;
    go(touchState.deltaX < 0 ? 1 : -1);
  };

  const handleTouchCancel = () => {
    touchRef.current.deltaX = 0;
    touchRef.current.deltaY = 0;
    touchRef.current.isZoomGesture = true;
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
        <div className="min-w-0 pr-3">
          <span className="block truncate text-[11px] font-bold uppercase tracking-[0.1em] text-black/35">
            {photo.filename || "Preview"}
          </span>
          {capturedAt && (
            <span className="mt-0.5 block text-[10px] font-medium text-neutral-500">
              Taken {capturedAt} Athens time
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/5 text-black active:scale-90"
        >
          <X className="h-4 w-4" strokeWidth={2.6} />
        </button>
      </div>

      <div
        ref={viewportRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        className="relative mx-4 mb-4 flex-1 overflow-hidden rounded-2xl bg-neutral-100 touch-none"
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={photo.id}
            initial={{ x: direction * 70, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction * -70, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="absolute inset-0"
          >
            <div
              className="relative flex h-full w-full select-none items-center justify-center"
              style={{
                transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`,
              }}
            >
              <img
                src={photo.preview_url}
                alt={photo.filename || "Photo preview"}
                loading="lazy"
                draggable={false}
                className="max-h-full max-w-full object-contain"
              />
              {!isFree && <Watermark large />}
            </div>
          </motion.div>
        </AnimatePresence>

        <button
          type="button"
          onClick={() => go(-1)}
          disabled={!hasPrev}
          aria-label="Previous photo"
          className="absolute left-2 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[#E5E7EB] bg-white/90 text-black shadow-sm backdrop-blur transition-opacity active:scale-90 disabled:opacity-25 md:grid"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={!hasNext}
          aria-label="Next photo"
          className="absolute right-2 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[#E5E7EB] bg-white/90 text-black shadow-sm backdrop-blur transition-opacity active:scale-90 disabled:opacity-25 md:grid"
        >
          <ChevronRight className="h-5 w-5" strokeWidth={2.4} />
        </button>
      </div>

      <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        {downloadError && (
          <p role="alert" className="mb-2 text-center text-sm text-red-700">
            {downloadError}
          </p>
        )}
        <button
          type="button"
          disabled={isFree && isDownloading}
          onClick={isFree ? onDownloadFree : onToggle}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-bold transition-transform active:scale-[0.99] disabled:opacity-60 ${
            isFree
              ? "bg-emerald-600 text-white"
              : selected
                ? "border border-[#E5E7EB] bg-white text-black"
                : "bg-[#0055FF] text-white"
          }`}
        >
          {isFree ? (
            <>
              <Download className="h-4 w-4" />
              {isDownloading ? "Preparing Download…" : "Download Free"}
            </>
          ) : selected ? (
            <>
              <Check className="h-4 w-4" strokeWidth={3} />
              Remove from Selection
            </>
          ) : (
            `Select Photo for ${formatMoney(price, currency)}`
          )}
        </button>
        {typeof onRequestRemoval === "function" && (
          <button
            type="button"
            onClick={onRequestRemoval}
            className="mt-3 block w-full text-center text-xs font-semibold text-neutral-500 underline"
          >
            {text.requestRemoval}
          </button>
        )}
      </div>
    </motion.div>
  );
}