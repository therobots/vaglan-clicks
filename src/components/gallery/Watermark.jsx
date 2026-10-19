import React from "react";

/**
 * The protective mark rendered on top of every unsold preview.
 */
export default function Watermark({ large = false }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 grid select-none place-items-center overflow-hidden"
    >
      <span
        className={`-rotate-[18deg] whitespace-nowrap font-black uppercase tracking-[-0.04em] text-white/60 ${
          large ? "text-[clamp(1.25rem,7vw,3.5rem)]" : "text-[clamp(0.55rem,4vw,1.6rem)]"
        }`}
        style={{ textShadow: "0 1px 8px rgba(0,0,0,0.75)" }}
      >
        @vaglan_clicks
      </span>
    </div>
  );
}