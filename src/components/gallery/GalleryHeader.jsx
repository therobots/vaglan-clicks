import React from "react";
import LiveStatusPill from "@/components/gallery/LiveStatusPill";

export default function GalleryHeader({ photoCount, children }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-black uppercase tracking-[0.14em] text-black">
            @VAGLAN_CLICKS
          </span>
          {typeof photoCount === "number" && (
            <span className="text-[11px] font-semibold text-black/35">{photoCount}</span>
          )}
        </div>
        {children || <LiveStatusPill state="offline" />}
      </div>
    </header>
  );
}