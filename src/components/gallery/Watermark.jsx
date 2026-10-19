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
      <div className="absolute inset-[-50%] grid -rotate-[24deg] grid-cols-3 place-items-center gap-x-8 gap-y-12">
        {Array.from({ length: 12 }, (_, index) => (
          <span
            key={index}
            className={`whitespace-nowrap font-black uppercase tracking-[-0.02em] text-white/55 ${
              large ? "text-[clamp(1rem,5vw,2.25rem)]" : "text-[clamp(0.45rem,2.2vw,0.8rem)]"
            }`}
            style={{ textShadow: "0 1px 8px rgba(0,0,0,0.75)" }}
          >
            @vaglan_clicks
          </span>
        ))}
      </div>
    </div>
  );
}