import React, { useEffect, useState } from "react";
import { parseTimestamp } from "@/lib/timeBuckets";

const WINDOW_MS = 48 * 60 * 60 * 1000;

/** Urgency strip: 48 hours from the shoot date, ticking down every 30 seconds. */
export default function ExpiryBanner({ event }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const start = event?.event_date
    ? new Date(`${event.event_date}T00:00:00`).getTime()
    : parseTimestamp(event?.created_date);

  if (!start || Number.isNaN(start)) return null;

  const remaining = start + WINDOW_MS - now;
  if (remaining <= 0) return null;

  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / 60000);

  return (
    <div className="sticky top-14 z-30 flex items-center justify-center gap-2 bg-black px-4 py-2">
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#EF4444]" />
      <p className="text-center text-[11px] font-bold leading-snug tracking-tight text-white">
        ⚡ Gallery expires in {hours}h {minutes}m. Download your shots before tonight's auto-purge!
      </p>
    </div>
  );
}