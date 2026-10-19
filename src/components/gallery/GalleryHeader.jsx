import React from "react";
import { Link } from "react-router-dom";
import LiveStatusBadge from "@/components/gallery/LiveStatusBadge";

export default function GalleryHeader({ eventId, eventLive = true, latestPhotoAt, photoCount }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-[#E5E7EB] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="text-[13px] font-black uppercase tracking-[0.14em] text-black">
            @vaglan_clicks
          </span>
          {typeof photoCount === "number" && (
            <span className="text-[11px] font-semibold text-black/35">{photoCount}</span>
          )}
        </Link>
        <LiveStatusBadge eventId={eventId} eventLive={eventLive} latestPhotoAt={latestPhotoAt} />
      </div>
    </header>
  );
}