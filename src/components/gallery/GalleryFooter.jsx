import React from "react";
import { Instagram } from "lucide-react";

export default function GalleryFooter() {
  return (
    <section className="mx-3 mt-8 rounded-2xl border border-[#E5E7EB] px-5 py-6 text-center">
      <h2 className="text-[15px] font-black leading-snug tracking-tight text-black">
        Want to see more shots & event highlights?
      </h2>
      <p className="mx-auto mt-1.5 max-w-[17rem] text-[12px] leading-relaxed text-black/50">
        Follow @vaglan_clicks on Instagram for full event drops & updates.
      </p>
      <a
        href="https://instagram.com/vaglan_clicks"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-black px-5 py-3.5 text-[13px] font-bold text-white transition-transform active:scale-[0.98]"
      >
        <Instagram className="h-4 w-4" strokeWidth={2.4} />
        Follow @vaglan_clicks
      </a>
    </section>
  );
}