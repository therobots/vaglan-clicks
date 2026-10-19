import React, { useEffect, useState } from "react";
import LiveStatusPill from "@/components/gallery/LiveStatusPill";
import { isSupabaseConfigured, supabase } from "@/supabaseClient";
import { parseTimestamp } from "@/lib/timeBuckets";

const POLL_INTERVAL = 5000;
const HEARTBEAT_WINDOW = 20000;
const UPLOAD_WINDOW = 10000;

export default function LiveStatusBadge({ eventId, eventLive = true, latestPhotoAt }) {
  const [status, setStatus] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!eventId || !isSupabaseConfigured || !supabase) {
      setStatus(null);
      return undefined;
    }

    let active = true;
    const poll = async () => {
      const { data, error } = await supabase
        .from("sync_status")
        .select("last_heartbeat, state")
        .eq("event_id", eventId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        console.error("Could not read event sync status:", error);
        setStatus(null);
      } else {
        setStatus(data);
      }
      setNow(Date.now());
    };

    poll().catch((error) => {
      if (!active) return;
      console.error("Could not read event sync status:", error);
      setStatus(null);
      setNow(Date.now());
    });
    const timer = setInterval(() => {
      poll().catch((error) => {
        if (!active) return;
        console.error("Could not read event sync status:", error);
        setStatus(null);
        setNow(Date.now());
      });
    }, POLL_INTERVAL);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [eventId]);

  if (!eventId) return null;

  const heartbeatAt = parseTimestamp(status?.last_heartbeat);
  const photoAt = parseTimestamp(latestPhotoAt);
  const syncing =
    eventLive &&
    Number.isFinite(heartbeatAt) &&
    now >= heartbeatAt &&
    now - heartbeatAt < HEARTBEAT_WINDOW;
  const uploading =
    eventLive &&
    ((Number.isFinite(photoAt) && now >= photoAt && now - photoAt < UPLOAD_WINDOW) ||
      (syncing && status?.state === "uploading"));

  return <LiveStatusPill state={uploading ? "uploading" : syncing ? "live" : "offline"} />;
}
