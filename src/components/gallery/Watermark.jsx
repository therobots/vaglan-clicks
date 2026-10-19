import React from "react";
import watermarkImg from "../../assets/watermark.png";

/**
 * The protective mark rendered on top of every unsold preview.
 */
export default function Watermark({ large = false }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 grid select-none place-items-center overflow-hidden p-4"
    >
      <img
        src={watermarkImg}
        alt="Vaglan Clicks Watermark"
        className={`object-contain opacity-50 transition-all duration-200 ${
          large 
            ? "w-[80%] max-w-[700px] max-h-[75vh]"  /* Balanced size for the zoomed lightbox */
            : "w-[85%] max-w-[280px] max-h-[40vh]"  /* Balanced size for the grid preview */        }`}
      />
    </div>
  );
}