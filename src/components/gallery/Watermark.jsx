import React from "react";

/**
 * The protective mark rendered on top of every unsold preview.
 */
export default function Watermark({ large = false }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <span
        className="select-none whitespace-nowrap font-black uppercase tracking-[-0.02em] text-white/60"
        style={{
          fontSize: large ? "clamp(1.25rem, 7vw, 3rem)" : "clamp(0.5rem, 3.2vw, 0.95rem)",
          textShadow: "0 1px 10px rgba(0,0,0,0.6)",
        }}
      >
        @vaglan_clicks
      </span>
    </div>
  );
}