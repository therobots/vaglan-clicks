import React, { useState } from "react";
import { Check } from "lucide-react";
import { previewUrl } from "@/lib/previewUrl";

function PhotoCard({ photo, album, selected, fetchPriority = "auto", onToggle, onOpen }) {
  const [failedSource, setFailedSource] = useState(null);
  /** @type {"high" | "low" | "auto"} */
  const imageFetchPriority =
    fetchPriority === "high" ? "high" : fetchPriority === "low" ? "low" : "auto";
  const imageSource = previewUrl(photo, album);
  const imageFailed = failedSource === imageSource;
  const alt = photo.filename || "Photo preview";

  return (
    <div
      className="relative aspect-square overflow-hidden bg-neutral-100 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {!imageSource || imageFailed ? (
        <div className="absolute inset-0 bg-neutral-100" role="img" aria-label={alt} />
      ) : (
        <img
          src={imageSource}
          alt={alt}
          width="300"
          height="300"
          loading={imageFetchPriority === "high" ? "eager" : "lazy"}
          fetchPriority={imageFetchPriority}
          decoding="async"
          draggable={false}
          onContextMenu={(event) => event.preventDefault()}
          onError={() => setFailedSource(imageSource)}
          className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none"
        />
      )}
      <button
        type="button"
        onClick={() => onOpen(photo)}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Open photo preview"
        className="absolute inset-0 z-20 cursor-zoom-in"
      />

      {!photo.is_free && (
        <button
          type="button"
          onClick={() => onToggle(photo.id)}
          aria-label={selected ? "Remove from selection" : "Select photo"}
          className={`absolute right-1.5 top-1.5 z-30 grid h-6 w-6 place-items-center rounded-full border transition-all duration-200 active:scale-90 ${
            selected
              ? "border-[#0055FF] bg-[#0055FF]"
              : "border-white/60 bg-black/40"
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

export default React.memo(PhotoCard);
