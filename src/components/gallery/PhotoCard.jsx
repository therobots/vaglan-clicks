import React from "react";
import { Check } from "lucide-react";
import { Image } from "@/components/ui/image";
import Watermark from "@/components/gallery/Watermark";

export default function PhotoCard({ photo, selected, onToggle, onOpen }) {
  return (
    <div
      className="relative aspect-[3/4] overflow-hidden bg-neutral-100 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Image
        src={photo.thumbnail_url || photo.preview_url}
        alt={photo.filename || "Photo preview"}
        loading="lazy"
        decoding="async"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        sizes="(max-width: 768px) 33vw, 220px"
        className={`absolute inset-0 h-full w-full scale-[1.04] pointer-events-none select-none ${
          photo.is_free ? "" : "blur-[2px]"
        }`}
      />
      {!photo.is_free && !photo.thumbnail_url && <Watermark />}

      <button
        type="button"
        onClick={onOpen}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Open photo preview"
        className="absolute inset-0 z-20 cursor-zoom-in"
      />

      {!photo.is_free && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={selected ? "Remove from selection" : "Select photo"}
          className={`absolute right-1.5 top-1.5 z-30 grid h-6 w-6 place-items-center rounded-full border transition-all duration-200 active:scale-90 ${
            selected
              ? "border-[#0055FF] bg-[#0055FF]"
              : "border-white/60 bg-black/20 backdrop-blur-sm"
          }`}
        >
          {selected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={4} />}
        </button>
      )}

      {selected && (
        <span className="pointer-events-none absolute inset-0 z-40 border-[2.5px] border-[#0055FF]" />
      )}
    </div>
  );
}