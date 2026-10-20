import { useEffect, useState } from "react";
import { formatAthensDateTime, parseTimestamp } from "@/lib/timeBuckets";

export default function ExpiryBanner({ expiresAt, serverOffsetMs = 0 }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  const expiry = parseTimestamp(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now + serverOffsetMs) return null;

  const availableUntil = formatAthensDateTime(expiry);
  return (
    <div
      role="status"
      aria-label={`Photos from this night are available until ${availableUntil} Athens time`}
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-900"
    >
      Photos from this night are available until {availableUntil} Athens time.
    </div>
  );
}
