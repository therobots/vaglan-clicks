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
        className={`object-contain opacity-60 ${
          large ? "w-3/4 max-h-[60vh]" : "w-1/2 max-h-[30vh]"
        }`}
      />
    </div>
  );
}