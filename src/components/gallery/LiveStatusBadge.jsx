const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useEffect, useState } from "react";

import LiveStatusPill from "@/components/gallery/LiveStatusPill";

const POLL_INTERVAL = 5000;
const HEARTBEAT_WINDOW = 20000;
const UPLOAD_WINDOW = 10000;

/**
 * Keeps the header badge honest about the camera laptop: it polls the shoot's
 * status record in the background (never blocking browsing or checkout) and
 * falls back to the newest arriving photo as proof that a batch is in flight.
 */
export default function LiveStatusBadge({ eventId, eventLive = true, latestPhotoAt }) {
  const [status, setStatus] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!eventId) return;
    let active = true;

    const poll = async () => {
      try {
        const page = await db.entities.SyncStatus.filter(
          { event_id: eventId },
          { sort: "-updated_date", limit: 1 }
        );
        if (active) setStatus(page.items[0] || null);
      } catch {
        if (active) setStatus(null);
      }
      if (active) setNow(Date.now());
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [eventId]);

  if (!eventId) return null;

  const heartbeatAt = status?.last_heartbeat ? new Date(status.last_heartbeat).getTime() : null;
  const syncing = eventLive && heartbeatAt !== null && now - heartbeatAt < HEARTBEAT_WINDOW;

  const photoAt = latestPhotoAt ? new Date(latestPhotoAt).getTime() : null;
  const uploading =
    eventLive &&
    ((photoAt !== null && now - photoAt < UPLOAD_WINDOW) ||
      (syncing && status?.state === "uploading"));

  const state = uploading ? "uploading" : syncing ? "live" : "offline";

  return <LiveStatusPill state={state} />;
}